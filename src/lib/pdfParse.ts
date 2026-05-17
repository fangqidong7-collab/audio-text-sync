// 用 pdfjs-dist 把 PDF 转成纯文本，并过滤掉常见噪声：
// - 水印（旋转文字）
// - 页眉页脚（在多页同位置重复出现的文字）
// - 页码（页眉/页脚区域的纯数字）
// 同时通过字号 vs Y 间距检测段落边界，输出 \n\n 让上层的 splitParagraphs 直接用。
//
// 动态 import：只在用户真的上传 PDF 时才下载 pdfjs，主包不受影响。

export interface PdfParseProgress {
  page: number;
  totalPages: number;
}

interface TextItemWithPos {
  str: string;
  transform: number[]; // [a, b, c, d, e, f]，e/f = x/y，b/c 不为 0 表示旋转
  hasEOL?: boolean;
}

interface PageData {
  items: TextItemWithPos[];
  height: number;
  width: number;
}

// 页眉/页脚区域比例（PDF 坐标里 y=0 在页底）
const HEADER_ZONE = 0.08; // 页面顶部 8%
const FOOTER_ZONE = 0.08; // 页面底部 8%
// 段落断点判定：当前行 Y 与上一行的间距 > 字号 * PARAGRAPH_GAP_RATIO
const PARAGRAPH_GAP_RATIO = 1.6;

function isRotated(transform: number[]): boolean {
  return Math.abs(transform[1]) > 0.01 || Math.abs(transform[2]) > 0.01;
}

function fontHeight(transform: number[]): number {
  // d 是垂直方向的缩放，绝对值约等于字号。
  return Math.abs(transform[3]) || 10;
}

function inHeader(y: number, h: number): boolean {
  return y > h * (1 - HEADER_ZONE);
}
function inFooter(y: number, h: number): boolean {
  return y < h * FOOTER_ZONE;
}

// 收集出现在多页页眉/页脚区域、且字符串重复的内容 → 视为页眉/页脚噪声。
function detectRepeatedHeaderFooter(pages: PageData[]): Set<string> {
  if (pages.length < 2) return new Set();
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const it of p.items) {
      const y = it.transform[5];
      if (!inHeader(y, p.height) && !inFooter(y, p.height)) continue;
      const key = it.str.trim();
      if (key.length === 0) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  // 出现在 ≥50% 页面的 → 重复页眉/页脚
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  const repeated = new Set<string>();
  for (const [s, c] of counts) {
    if (c >= threshold) repeated.add(s);
  }
  return repeated;
}

// 收集"全文档反复出现的旋转文字" → 水印。即便没旋转，整本相同短串也大概率是水印。
function detectWatermarks(pages: PageData[]): Set<string> {
  const rotatedCounts = new Map<string, number>();
  const allCounts = new Map<string, number>();
  let totalItems = 0;
  for (const p of pages) {
    for (const it of p.items) {
      const k = it.str.trim();
      if (k.length === 0) continue;
      totalItems++;
      allCounts.set(k, (allCounts.get(k) ?? 0) + 1);
      if (isRotated(it.transform)) {
        rotatedCounts.set(k, (rotatedCounts.get(k) ?? 0) + 1);
      }
    }
  }
  const wm = new Set<string>();
  // 任何旋转出现过 ≥1 次的字符串都加进去（水印基本都是旋转的）。
  for (const [s] of rotatedCounts) wm.add(s);
  // 同一短串（≤20 字）在全文重复出现 ≥pages*0.6 次也视为水印。
  for (const [s, c] of allCounts) {
    if (s.length <= 20 && c >= Math.max(3, pages.length * 0.6) && totalItems > 0) {
      wm.add(s);
    }
  }
  return wm;
}

function isPageNumber(s: string): boolean {
  // 阿拉伯数字 1~4 位，或"第 12 页 / Page 12 / -12-"等常见页码格式
  const t = s.trim();
  if (/^\d{1,4}$/.test(t)) return true;
  if (/^[-—–]\s*\d{1,4}\s*[-—–]$/.test(t)) return true;
  if (/^第\s*\d{1,4}\s*[页頁]$/.test(t)) return true;
  if (/^Page\s+\d{1,4}$/i.test(t)) return true;
  return false;
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

  // ===== Pass 1：收集所有页面的 text items 与尺寸 =====
  const pages: PageData[] = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.({ page: pageNum, totalPages });
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = (content.items as TextItemWithPos[]).filter(
      (it) => 'str' in it,
    );
    pages.push({
      items,
      height: viewport.height,
      width: viewport.width,
    });
  }

  const repeatedHF = detectRepeatedHeaderFooter(pages);
  const watermarks = detectWatermarks(pages);

  // ===== Pass 2：按行/段输出文本 =====
  const pageTexts: string[] = [];
  for (const p of pages) {
    let lastY: number | null = null;
    let lastFontH = 10;
    let lineBuf = '';
    const lines: string[] = [];

    const flushLine = () => {
      if (lineBuf.trim().length > 0) lines.push(lineBuf.trim());
      lineBuf = '';
    };

    for (const it of p.items) {
      const trimmed = it.str.trim();
      const y = it.transform[5];
      const fontH = fontHeight(it.transform);

      // ---- 噪声过滤 ----
      if (isRotated(it.transform)) continue; // 水印（旋转文字）
      if (trimmed.length > 0 && watermarks.has(trimmed)) continue; // 水印（重复短串）
      if (inHeader(y, p.height) || inFooter(y, p.height)) {
        if (repeatedHF.has(trimmed)) continue;
        if (isPageNumber(trimmed)) continue;
      }
      if (trimmed.length === 0 && it.str.length === 0) continue;

      // ---- 行/段断点 ----
      if (lastY !== null) {
        const gap = Math.abs(y - lastY);
        // 同一行（baseline 几乎相等）→ 直接拼接，不换行
        if (gap > fontH * 0.4) {
          flushLine();
          if (gap > Math.max(fontH, lastFontH) * PARAGRAPH_GAP_RATIO) {
            // 段落分隔：插入空行（上层 splitParagraphs 用 \n\n 切段）
            lines.push('');
          }
        }
      }

      lineBuf += it.str;
      if (it.hasEOL) flushLine();
      lastY = y;
      lastFontH = fontH;
    }
    flushLine();
    pageTexts.push(lines.join('\n'));
  }

  // 页面之间也用空行分隔
  return pageTexts.join('\n\n');
}
