// 用 pdfjs-dist 把 PDF 转成纯文本。
// 关键点：
// - 在浏览器里使用 worker（pdfjs 5.x 用的是 .mjs 后缀的 worker 文件）。
// - 按页提取文字项，再依据 Y 坐标变化推断换行 / 段落分隔，避免所有内容拼成一长行。
// - 动态 import：只在用户真的上传 PDF 时才下载 pdfjs，主包不受影响。

export interface PdfParseProgress {
  page: number;
  totalPages: number;
}

interface TextItemWithPos {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

export async function extractPdfText(
  file: File,
  onProgress?: (p: PdfParseProgress) => void,
): Promise<string> {
  const [pdfjs, workerMod] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = (workerMod as { default: string }).default;

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.({ page: pageNum, totalPages });
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const items = content.items as TextItemWithPos[];
    let lastY: number | null = null;
    let lineBuf = '';
    const lines: string[] = [];

    for (const it of items) {
      if (!('str' in it)) continue;
      const y = it.transform?.[5] ?? 0;
      // Y 坐标变化超过 2 像素，认为是新一行。
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (lineBuf.trim().length > 0) lines.push(lineBuf.trim());
        lineBuf = '';
      }
      lineBuf += it.str;
      // pdfjs 给某些项设置 hasEOL（比如对齐换行）；hasEOL 时也强制换行。
      if (it.hasEOL) {
        if (lineBuf.trim().length > 0) lines.push(lineBuf.trim());
        lineBuf = '';
      }
      lastY = y;
    }
    if (lineBuf.trim().length > 0) lines.push(lineBuf.trim());

    // 简单的段落合并：相邻短行（不以句末标点结尾）合并；空行作为段落分隔。
    const merged: string[] = [];
    for (const ln of lines) {
      if (merged.length === 0) {
        merged.push(ln);
        continue;
      }
      const prev = merged[merged.length - 1];
      const endsWithSentence = /[。！？!?.…」』）)\]]$/.test(prev);
      if (!endsWithSentence && prev.length < 80) {
        merged[merged.length - 1] = prev + ln;
      } else {
        merged.push(ln);
      }
    }
    pageTexts.push(merged.join('\n'));
  }

  return pageTexts.join('\n\n');
}
