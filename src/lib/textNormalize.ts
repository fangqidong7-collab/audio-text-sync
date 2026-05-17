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

// 把段落切成"句子级"片段：按中英文句末标点切分。
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？!?…\n])|(?<=\.)\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}
