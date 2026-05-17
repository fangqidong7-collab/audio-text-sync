import { normalize } from './textNormalize';

// 文档中的一个段落（或句子），对齐后会得到时间区间。
export interface DocSegment {
  id: number;
  text: string; // 原始文本（保留标点用于显示）
  start?: number; // 秒
  end?: number; // 秒
  matched: boolean;
  confidence?: number; // 0~1，越高越可信
}

// 把段落按"归一化字符数加权"均匀分布到整段音频时长上。
// 这是一个粗略估计，用户可以通过双击重锚来纠正偏差。
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
