import { distance } from 'fastest-levenshtein';
import { normalize } from './textNormalize';

// ASR 输出的一个带时间戳的小片段（chunk），通常是一个短语或一句话。
export interface TimedChunk {
  text: string;
  start: number; // 秒
  end: number;   // 秒
}

// 文档中的一个段落（或句子），对齐后会得到时间区间。
export interface DocSegment {
  id: number;
  text: string;       // 原始文本（保留标点用于显示）
  start?: number;     // 秒
  end?: number;       // 秒
  matched: boolean;   // 是否在音频中找到
  confidence?: number; // 0~1，越高越可信
}

// ===== 模糊对齐核心 =====
//
// 思路：
// 1. 把 ASR 的所有 chunk 串联成一条"已知带时间轴的文本流"S，并构造字符索引 -> 时间 的映射。
// 2. 把文档每个段落归一化得到查询串 q。
// 3. 在 S 里寻找与 q 最相似的子串：用滑动窗口 + Levenshtein 距离的近似算法。
//    完整的 approximate string matching 是 O(n*m)，对 30 分钟音频来说 n~10k 字符，m 一般 <200，
//    我们对每个段落跑一次，总成本是可接受的（约 segments * 10k * 平均段长）。
// 4. 若最佳相似度 >= 阈值，就把窗口的字符索引映射回时间轴，得到段落 [start, end]。
//
// 这种方法对"漏读/跳读/口误"都有较强容忍度。

interface CharStream {
  text: string;            // 归一化后的连续字符串
  charToTime: number[];    // 每个字符对应的"中心"秒数
}

function buildCharStream(chunks: TimedChunk[]): CharStream {
  let acc = '';
  const charToTime: number[] = [];
  for (const c of chunks) {
    const norm = normalize(c.text);
    if (norm.length === 0) continue;
    // 把 chunk 内部的字符按时间均匀分布
    const span = Math.max(c.end - c.start, 0.01);
    for (let i = 0; i < norm.length; i++) {
      const t = c.start + (span * (i + 0.5)) / norm.length;
      charToTime.push(t);
    }
    acc += norm;
  }
  return { text: acc, charToTime };
}

// 在 stream 中找与 query 最相似的窗口。
// 返回 {bestStart, bestEnd, bestDist}，索引是 stream.text 的字符下标，左闭右开。
function findBestWindow(
  stream: string,
  query: string,
  searchStart: number,
  searchEnd: number,
): { bestStart: number; bestEnd: number; bestDist: number } | null {
  if (query.length === 0 || stream.length === 0) return null;
  const m = query.length;
  // 让窗口长度在 [m*0.6, m*1.6] 之间扫描，更稳健。
  const lens = [
    Math.max(1, Math.floor(m * 0.7)),
    m,
    Math.ceil(m * 1.3),
  ];
  // 步长：query 较长时跳得快一点，平衡精度与性能。
  const step = Math.max(1, Math.floor(m / 8));

  let best: { bestStart: number; bestEnd: number; bestDist: number } | null = null;
  for (const L of lens) {
    const upper = Math.min(stream.length, searchEnd) - L;
    for (let i = Math.max(0, searchStart); i <= upper; i += step) {
      const sub = stream.slice(i, i + L);
      const d = distance(sub, query);
      if (best === null || d < best.bestDist) {
        best = { bestStart: i, bestEnd: i + L, bestDist: d };
        // 提前剪枝：若距离已经 0，不可能更好。
        if (d === 0) return best;
      }
    }
  }

  // 在最佳粗匹配附近做精扫描（步长=1），得到更准的边界。
  if (best) {
    const { bestStart } = best;
    const L = best.bestEnd - best.bestStart;
    const left = Math.max(0, bestStart - step);
    const right = Math.min(stream.length - L, bestStart + step);
    for (let i = left; i <= right; i++) {
      const sub = stream.slice(i, i + L);
      const d = distance(sub, query);
      if (d < best.bestDist) {
        best = { bestStart: i, bestEnd: i + L, bestDist: d };
      }
    }
  }
  return best;
}

export interface AlignOptions {
  // 相似度阈值（1 - dist/queryLen），低于此值视为"未匹配"。
  minConfidence?: number;
  // 是否要求顺序单调（推荐）：后一段的开始 >= 前一段的开始，避免回跳。
  monotonic?: boolean;
}

export function alignDocumentToAudio(
  segments: { id: number; text: string }[],
  chunks: TimedChunk[],
  opts: AlignOptions = {},
): DocSegment[] {
  const minConfidence = opts.minConfidence ?? 0.55;
  const monotonic = opts.monotonic ?? true;

  const stream = buildCharStream(chunks);
  if (stream.text.length === 0) {
    return segments.map((s) => ({ ...s, matched: false }));
  }

  let cursor = 0; // 用于单调约束
  const result: DocSegment[] = [];

  for (const seg of segments) {
    const q = normalize(seg.text);
    if (q.length < 2) {
      // 太短的段落（如空行/标题字符）不参与对齐。
      result.push({ ...seg, matched: false });
      continue;
    }

    const searchStart = monotonic ? cursor : 0;
    const searchEnd = stream.text.length;
    const found = findBestWindow(stream.text, q, searchStart, searchEnd);

    if (!found) {
      result.push({ ...seg, matched: false });
      continue;
    }

    const conf = 1 - found.bestDist / Math.max(q.length, 1);
    if (conf < minConfidence) {
      result.push({ ...seg, matched: false, confidence: conf });
      continue;
    }

    const start = stream.charToTime[found.bestStart] ?? 0;
    const end =
      stream.charToTime[Math.min(found.bestEnd - 1, stream.charToTime.length - 1)] ??
      start;

    result.push({
      ...seg,
      matched: true,
      start,
      end: Math.max(end, start + 0.01),
      confidence: conf,
    });

    if (monotonic) {
      cursor = found.bestEnd;
    }
  }

  return result;
}

// 手动模式：没有 ASR 时，把段落按"字符数加权"均匀分布到整段音频时长上。
export function alignByLengthDistribution(
  segments: { id: number; text: string }[],
  audioDurationSec: number,
): DocSegment[] {
  const totalChars = segments.reduce(
    (acc, s) => acc + Math.max(normalize(s.text).length, 1),
    0,
  );
  let t = 0;
  return segments.map((s) => {
    const len = Math.max(normalize(s.text).length, 1);
    const dur = (len / totalChars) * audioDurationSec;
    const start = t;
    const end = t + dur;
    t = end;
    return { ...s, start, end, matched: true, confidence: 0.3 };
  });
}
