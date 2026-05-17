// 文本归一化：去掉标点/空白/大小写差异，便于模糊匹配。
// 中文标点和英文标点全部移除；空白折叠为单个空格。

const PUNCT_REGEX =
  /[\s\p{P}\p{S}]+/gu;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(PUNCT_REGEX, '')
    .trim();
}

// 把文本切成"句子级"片段：按中英文句末标点切分。
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？!?…\n])|(?<=\.)\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}

// 把文本切成"段落级"片段：
// - 优先按空行分段（PDF/MD/纯文本通用）
// - 没有空行时，按句子聚合成 ~目标长度 的段落
// - 任意段超过 MAX_PARAGRAPH_CHARS 则用句子再细分
const MAX_PARAGRAPH_CHARS = 400;
const TARGET_PARAGRAPH_CHARS = 160;

export function splitParagraphs(text: string): string[] {
  const t = text.replace(/\r\n/g, '\n');
  const hasBlankLines = /\n\s*\n/.test(t);

  let blocks: string[];
  if (hasBlankLines) {
    blocks = t
      .split(/\n\s*\n+/)
      // 段内单换行只是 PDF/折行视觉换行，压缩成空格
      .map((s) => s.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0);
  } else {
    const sents = splitSentences(t);
    blocks = [];
    let buf = '';
    for (const s of sents) {
      if (buf && buf.length + s.length > TARGET_PARAGRAPH_CHARS) {
        blocks.push(buf);
        buf = s;
      } else {
        buf = buf ? buf + s : s;
      }
    }
    if (buf) blocks.push(buf);
  }

  const result: string[] = [];
  for (const block of blocks) {
    if (block.length <= MAX_PARAGRAPH_CHARS) {
      result.push(block);
      continue;
    }
    const sentences = splitSentences(block);
    let buf = '';
    for (const s of sentences) {
      if (buf && buf.length + s.length > MAX_PARAGRAPH_CHARS) {
        result.push(buf);
        buf = s;
      } else {
        buf = buf ? buf + s : s;
      }
    }
    if (buf) result.push(buf);
  }
  return result;
}
