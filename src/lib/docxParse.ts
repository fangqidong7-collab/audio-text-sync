// .docx (OOXML) 解析器：使用 mammoth.js 提取文本。
// 旧版 .doc（OLE 二进制）格式没有靠谱的纯前端解析器；
// 这里如果被传进来，会显式抛错提示用户另存为 .docx。

// mammoth 体积较大（~ 500KB），按需动态加载，
// 这样首屏 bundle 不会被它拖累。
export async function extractDocxText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    throw new Error(
      '暂不支持旧版 .doc 格式，请在 Word 里"另存为"成 .docx 再上传。',
    );
  }
  const buf = await file.arrayBuffer();
  const mammoth = await import('mammoth');
  const out = await mammoth.extractRawText({ arrayBuffer: buf });
  return out.value || '';
}
