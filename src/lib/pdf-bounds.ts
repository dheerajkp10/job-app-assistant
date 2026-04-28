/**
 * Minimal PDF parser that extracts the vertical bounds of text on the
 * first page. Used by the resume-tailoring flow to balance top/bottom
 * whitespace AFTER LibreOffice has rendered the docx — LibreOffice
 * doesn't reliably honor `<w:vAlign w:val="center"/>` on section
 * properties, so we measure where content actually landed and shift
 * the docx top margin to make the visible top/bottom whitespace equal.
 *
 * What we extract from the PDF
 * ────────────────────────────
 *  - Page height (from `/MediaBox`).
 *  - All text-rendering Y positions on page 1 (from `Tm` operators —
 *    LibreOffice consistently uses an absolute text matrix per text
 *    object, so this gives us the position of every glyph block).
 *  - Min and max Y across those positions: `minY` is the lowest text
 *    on the page (smallest Y, since PDF y=0 is at page bottom),
 *    `maxY` is the highest.
 *
 * From those we derive:
 *   topGap    = pageHeight - maxY     (whitespace above first content)
 *   bottomGap = minY                  (whitespace below last content)
 *
 * Why a hand-rolled parser
 * ────────────────────────
 * Adding `pdfjs-dist` for one measurement step felt heavy (it ships
 * MB of code and Node-incompatible CSS/HTML helpers). LibreOffice's
 * PDF output is small enough and predictable enough that a 100-line
 * regex-driven extractor is reliable for this single use-case. We
 * accept FlateDecode-compressed content streams (the only filter
 * LibreOffice ever uses for text content) and ignore anything else.
 */

import zlib from 'zlib';

export interface PdfBounds {
  /** Page height in PDF points (1pt = 1/72 inch ≈ 20 twips). */
  pageHeight: number;
  /** Smallest Y of any text glyph on page 1 (page bottom is y=0). */
  minY: number;
  /** Largest Y of any text glyph on page 1. */
  maxY: number;
  /** Whitespace from the top of the page to the highest text. */
  topGap: number;
  /** Whitespace from the bottom of the page to the lowest text. */
  bottomGap: number;
}

/**
 * Attempt to measure text bounds on the first page of a PDF.
 * Returns null on parse failure (compressed-stream variant we don't
 * recognize, atypical content-stream layout, etc.) so callers can
 * gracefully skip the balancing step.
 */
export function measurePdfTextBounds(pdfBuffer: Buffer): PdfBounds | null {
  // PDF body is mostly latin-1; treating the bytes as a binary string
  // gives us a stable substring-match surface without UTF-8 mangling.
  const raw = pdfBuffer.toString('binary');

  // ── Find the first page's MediaBox and Contents reference ──
  // Walk every "/Type /Page" object until we find one carrying the
  // page's own attributes (some PDFs put MediaBox on /Pages instead;
  // we fall back to /Pages on miss).
  const pageMatch = raw.match(/<<[^>]*?\/Type\s*\/Page\b[\s\S]*?>>/);
  const pagesMatch = raw.match(/<<[^>]*?\/Type\s*\/Pages\b[\s\S]*?>>/);
  const pageDict = pageMatch ? pageMatch[0] : null;
  const pagesDict = pagesMatch ? pagesMatch[0] : null;

  // MediaBox can appear on the page or inherited from /Pages.
  const mediaBoxRegex = /\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/;
  let mediaBoxMatch: RegExpMatchArray | null = null;
  if (pageDict) mediaBoxMatch = pageDict.match(mediaBoxRegex);
  if (!mediaBoxMatch && pagesDict) mediaBoxMatch = pagesDict.match(mediaBoxRegex);
  if (!mediaBoxMatch) return null;
  const pageHeight = parseFloat(mediaBoxMatch[4]);
  if (!isFinite(pageHeight) || pageHeight <= 0) return null;

  // ── Resolve /Contents ──
  // Page /Contents is either a single indirect reference (e.g. `7 0 R`)
  // or an array of references. LibreOffice typically emits a single
  // ref. We support both forms.
  if (!pageDict) return null;
  const contentsMatch = pageDict.match(/\/Contents\s*(\d+\s+\d+\s+R|\[[^\]]+\])/);
  if (!contentsMatch) return null;

  const refs: { num: string; gen: string }[] = [];
  if (contentsMatch[1].startsWith('[')) {
    const innerRefs = contentsMatch[1].matchAll(/(\d+)\s+(\d+)\s+R/g);
    for (const m of innerRefs) refs.push({ num: m[1], gen: m[2] });
  } else {
    const m = contentsMatch[1].match(/(\d+)\s+(\d+)\s+R/);
    if (m) refs.push({ num: m[1], gen: m[2] });
  }
  if (refs.length === 0) return null;

  // ── Concatenate all content streams ──
  let allOps = '';
  for (const ref of refs) {
    const obj = extractObject(raw, ref.num, ref.gen, pdfBuffer);
    if (obj) allOps += obj + '\n';
  }
  if (allOps.length === 0) return null;

  // ── Parse text-positioning per BT…ET block ──
  // PDF text-rendering operators inside a `BT … ET` text object:
  //   • `BT` resets the text matrix and line matrix to identity.
  //   • `Tm a b c d e f` sets an absolute text matrix; Y = 6th operand.
  //   • `Td x y`         translates by (x, y) from the current line.
  //   • `TD x y`         like Td and also sets leading.
  //   • `T*`             moves to next line using current leading.
  //
  // LibreOffice's typical output is one BT…ET per visible line with a
  // single `Td x y` placing the line. We walk each BT block, track Y
  // through Tm/Td/TD operations relative to the block's reset origin
  // (0, 0), and record every position where a text-show operator
  // (`Tj`, `TJ`, `'`, `"`) actually paints glyphs.
  const ys: number[] = [];
  const blockRegex = /BT\b([\s\S]*?)\bET\b/g;
  let bm: RegExpExecArray | null;
  // Match individual operators in tokenized order.
  const opRegex = /([\d.\-]+(?:\s+[\d.\-]+){0,5})\s+(Tm|Td|TD|T\*|Tj|TJ|'|")\b|\b(Tj|TJ|T\*|')\b/g;
  while ((bm = blockRegex.exec(allOps)) !== null) {
    const body = bm[1];
    // Position state local to this BT block (reset at each BT).
    let curX = 0;
    let curY = 0;
    let leading = 0;
    let painted = false;
    let om: RegExpExecArray | null;
    opRegex.lastIndex = 0;
    while ((om = opRegex.exec(body)) !== null) {
      const operands = om[1];
      const op = om[2] || om[3];
      const nums = operands ? operands.split(/\s+/).map(parseFloat) : [];
      if (op === 'Tm') {
        // absolute matrix — Y is operand 6 (index 5)
        if (nums.length === 6 && isFinite(nums[5])) {
          curX = nums[4];
          curY = nums[5];
        }
      } else if (op === 'Td') {
        if (nums.length === 2) { curX += nums[0]; curY += nums[1]; }
      } else if (op === 'TD') {
        if (nums.length === 2) {
          curX += nums[0];
          curY += nums[1];
          leading = -nums[1];
        }
      } else if (op === "T*") {
        curY -= leading;
      } else if (op === 'Tj' || op === 'TJ' || op === "'" || op === '"') {
        // Text-show operator — record current Y as a glyph position.
        // (We don't bother sub-tracking width / x — we only need Y for
        // the top/bottom-gap calculation.)
        if (isFinite(curY)) {
          ys.push(curY);
          painted = true;
        }
      }
    }
    // Suppress unused-var lint on `painted` / `curX` — kept for clarity.
    void painted;
    void curX;
  }
  if (ys.length === 0) return null;

  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    pageHeight,
    minY,
    maxY,
    topGap: pageHeight - maxY,
    bottomGap: minY,
  };
}

/**
 * Locate `<num> <gen> obj ... endobj` and return the decoded content
 * stream inside, decompressing /FlateDecode if present.
 *
 * Why bytes vs. string: the content stream may contain arbitrary
 * binary (FlateDecode-compressed) data. We need the byte offsets
 * from the latin-1 string scan but the actual decompression has to
 * run on the original Buffer slice.
 */
function extractObject(raw: string, num: string, gen: string, pdfBuffer: Buffer): string | null {
  const objHeader = `${num} ${gen} obj`;
  const objStart = raw.indexOf(objHeader);
  if (objStart < 0) return null;
  const objEnd = raw.indexOf('endobj', objStart);
  if (objEnd < 0) return null;
  const obj = raw.substring(objStart, objEnd);

  // Stream content lives between `stream\n` and `\nendstream`.
  const streamIdx = obj.indexOf('stream');
  if (streamIdx < 0) return null;
  // Skip past `stream` and the following EOL (either \n or \r\n).
  let bodyStart = streamIdx + 'stream'.length;
  if (obj[bodyStart] === '\r') bodyStart++;
  if (obj[bodyStart] === '\n') bodyStart++;
  const endStreamIdx = obj.lastIndexOf('endstream');
  if (endStreamIdx < 0) return null;
  // Strip the trailing EOL before `endstream`.
  let bodyEnd = endStreamIdx;
  if (obj[bodyEnd - 1] === '\n') bodyEnd--;
  if (obj[bodyEnd - 1] === '\r') bodyEnd--;

  const absoluteBodyStart = objStart + bodyStart;
  const absoluteBodyEnd = objStart + bodyEnd;
  const streamBytes = pdfBuffer.subarray(absoluteBodyStart, absoluteBodyEnd);

  const dict = obj.substring(0, streamIdx);
  const isFlate = /\/Filter\s*(?:\[[^\]]*?\/FlateDecode|\/FlateDecode)/.test(dict);
  try {
    if (isFlate) {
      return zlib.inflateSync(streamBytes).toString('binary');
    }
    return streamBytes.toString('binary');
  } catch {
    // Compressed-stream variant we don't recognize — skip silently;
    // the caller treats a null result as "couldn't measure".
    return null;
  }
}
