import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { DetectedImportFileKind, detectImportFileType } from './detectType';

export interface ExtractedSheetTable {
  sheetName: string;
  rows: string[][];
}

export interface RawTableExtractionResult {
  ok: boolean;
  fileKind: DetectedImportFileKind;
  sheets: ExtractedSheetTable[];
  requiresOcr?: boolean; // True for images or scanned PDFs with no selectable text
  isFullJsonBackup?: boolean;
  jsonBackupPayload?: any;
  detectedDelimiter?: string;
  detectedEncoding?: string;
  errorMessage?: string;
}

/**
 * Decodes text buffer automatically detecting UTF-8 vs Windows-1256 (Arabic) when garbled replacement chars appear.
 */
export function decodeArabicTextBuffer(bytes: Uint8Array): {
  text: string;
  encoding: string;
} {
  // Strip UTF-8 BOM if present
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const utf8 = new TextDecoder('utf-8').decode(bytes.subarray(3));
    return { text: utf8, encoding: 'UTF-8 (BOM)' };
  }

  const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
  const utf8Text = utf8Decoder.decode(bytes);
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;

  if (replacementCount > 2) {
    try {
      const win1256 = new TextDecoder('windows-1256').decode(bytes);
      return { text: win1256, encoding: 'Windows-1256' };
    } catch {
      return { text: utf8Text, encoding: 'UTF-8' };
    }
  }
  return { text: utf8Text, encoding: 'UTF-8' };
}

/**
 * Auto-detects delimiter (`,`, `;`, `\t`, `|`) and parses CSV/TSV/TXT into a 2D string array.
 */
export function parseDelimitedTextToRows(text: string): {
  rows: string[][];
  delimiter: string;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { rows: [], delimiter: ',' };

  const candidates = ['\t', ';', ',', '|'];
  let bestDelim = ',';
  let bestScore = -1;

  const sampleLines = lines.slice(0, Math.min(10, lines.length));
  for (const delim of candidates) {
    const counts = sampleLines.map((l) => l.split(delim).length - 1);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (avg >= 1 && avg > bestScore) {
      bestScore = avg;
      bestDelim = delim;
    }
  }

  const parseLine = (line: string, delim: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  return {
    rows: lines.map((l) => parseLine(l, bestDelim)),
    delimiter: bestDelim === '\t' ? 'Tab (\\t)' : bestDelim,
  };
}

/**
 * Parses HTML `<table>` elements into extracted sheets.
 */
export function parseHtmlTablesToSheets(htmlText: string): ExtractedSheetTable[] {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  return tables
    .map((tbl, idx) => {
      const trs = Array.from(tbl.querySelectorAll('tr'));
      const rows = trs
        .map((tr) =>
          Array.from(tr.querySelectorAll('th, td')).map((cell) =>
            (cell.textContent || '').trim()
          )
        )
        .filter((r) => r.some((c) => c !== ''));
      return {
        sheetName: `جدول HTML ${idx + 1}`,
        rows,
      };
    })
    .filter((s) => s.rows.length > 0);
}

/**
 * Parses Markdown pipe tables (`| col1 | col2 |`) into a 2D array.
 */
export function parseMarkdownTablesToRows(mdText: string): string[][] {
  const lines = mdText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('|'));

  const rows: string[][] = [];
  for (const line of lines) {
    // Skip markdown separator lines like |---|---|
    if (/^\|?[\s\-:|]+\|?$/.test(line)) continue;
    const cleaned = line.replace(/^\|/, '').replace(/\|$/, '');
    const cells = cleaned.split('|').map((c) => c.trim());
    if (cells.some((c) => c !== '')) {
      rows.push(cells);
    }
  }
  return rows;
}

/**
 * Extracts `<w:tbl>` tables from a `.docx` file offline using JSZip + XML parsing.
 */
async function extractDocxTables(bytes: Uint8Array): Promise<ExtractedSheetTable[]> {
  const zip = await JSZip.loadAsync(bytes);
  const docFile = zip.file('word/document.xml');
  if (!docFile) return [];
  const xmlStr = await docFile.async('string');

  if (typeof DOMParser !== 'undefined') {
    const xmlDoc = new DOMParser().parseFromString(xmlStr, 'application/xml');
    const tbls = Array.from(xmlDoc.getElementsByTagName('w:tbl'));
    return tbls
      .map((tbl, idx) => {
        const trs = Array.from(tbl.getElementsByTagName('w:tr'));
        const rows = trs
          .map((tr) => {
            const tcs = Array.from(tr.getElementsByTagName('w:tc'));
            return tcs.map((tc) => {
              const ts = Array.from(tc.getElementsByTagName('w:t'));
              return ts.map((t) => t.textContent || '').join('').trim();
            });
          })
          .filter((r) => r.some((c) => c !== ''));
        return {
          sheetName: `جدول وورد ${idx + 1}`,
          rows,
        };
      })
      .filter((s) => s.rows.length > 0);
  }
  return [];
}

/**
 * Extracts text rows offline from a PDF using `pdfjs-dist`.
 * If the PDF has no selectable text (scanned image PDF), returns `requiresOcr: true`.
 */
async function extractPdfTextTables(bytes: Uint8Array): Promise<{
  sheets: ExtractedSheetTable[];
  requiresOcr: boolean;
}> {
  try {
    const pdfjs = await import('pdfjs-dist');
    try {
      const workerUrl = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    } catch {
      // ignore worker setup fallback
    }

    const loadingTask = pdfjs.getDocument({ data: bytes.slice(0) });
    const pdf = await loadingTask.promise;
    const allRows: string[][] = [];
    let totalTextItems = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const items = (content.items || []) as any[];
      totalTextItems += items.length;

      // Group text items by Y coordinate (within 4px tolerance) to reconstruct table rows
      const lineBuckets: { y: number; items: { x: number; str: string }[] }[] = [];
      for (const it of items) {
        const str = String(it.str || '').trim();
        if (!str) continue;
        const x = Number(it.transform?.[4]) || 0;
        const y = Number(it.transform?.[5]) || 0;
        let bucket = lineBuckets.find((b) => Math.abs(b.y - y) <= 4);
        if (!bucket) {
          bucket = { y, items: [] };
          lineBuckets.push(bucket);
        }
        bucket.items.push({ x, str });
      }

      // Sort top-to-bottom (higher Y first in PDF coordinates)
      lineBuckets.sort((a, b) => b.y - a.y);

      for (const b of lineBuckets) {
        // Sort RTL (higher X first for Arabic tables)
        b.items.sort((a, c) => c.x - a.x);
        const cells = b.items.map((x) => x.str);
        if (cells.length >= 2) {
          allRows.push(cells);
        } else if (cells.length === 1) {
          // Split by 2+ spaces if a whole row was emitted as a single string
          const parts = cells[0].split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
          if (parts.length >= 2) allRows.push(parts);
        }
      }
    }

    if (totalTextItems < 5 || allRows.length === 0) {
      return { sheets: [], requiresOcr: true };
    }

    return {
      sheets: [{ sheetName: 'صفحات PDF النصية', rows: allRows }],
      requiresOcr: false,
    };
  } catch {
    return { sheets: [], requiresOcr: true };
  }
}

/**
 * G3.2 (Step 2): Extracts raw 2D tables from any supported file format.
 */
export async function extractRawTablesFromFile(
  fileName: string,
  bytes: Uint8Array,
  fileKindOverride?: DetectedImportFileKind
): Promise<RawTableExtractionResult> {
  const detected = detectImportFileType(fileName, bytes);
  if (!detected.ok && !fileKindOverride) {
    return {
      ok: false,
      fileKind: 'unknown',
      sheets: [],
      errorMessage: detected.errorMessage || 'تعذر قراءة الملف',
    };
  }

  const kind = fileKindOverride || detected.fileKind;

  try {
    if (kind === 'image') {
      return {
        ok: true,
        fileKind: 'image',
        sheets: [],
        requiresOcr: true,
      };
    }

    if (kind === 'excel') {
      const wb = XLSX.read(bytes, { type: 'array' });
      const sheets: ExtractedSheetTable[] = [];
      for (const sName of wb.SheetNames) {
        const ws = wb.Sheets[sName];
        const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const strRows = aoa
          .map((r) => r.map((c) => String(c ?? '').trim()))
          .filter((r) => r.some((c) => c !== ''));
        if (strRows.length > 0) {
          sheets.push({ sheetName: sName, rows: strRows });
        }
      }
      return {
        ok: sheets.length > 0,
        fileKind: 'excel',
        sheets,
        errorMessage: sheets.length === 0 ? 'ملف الإكسل فارغ ولا يحتوي على صفوف.' : undefined,
      };
    }

    if (kind === 'csv') {
      const { text, encoding } = decodeArabicTextBuffer(bytes);
      // Also check if it's Markdown pipe table
      if (text.includes('|') && text.split('\n').filter((l) => l.includes('|')).length >= 2) {
        const mdRows = parseMarkdownTablesToRows(text);
        if (mdRows.length >= 2) {
          return {
            ok: true,
            fileKind: 'markdown',
            sheets: [{ sheetName: fileName, rows: mdRows }],
            detectedDelimiter: '|',
            detectedEncoding: encoding,
          };
        }
      }
      const { rows, delimiter } = parseDelimitedTextToRows(text);
      return {
        ok: rows.length > 0,
        fileKind: 'csv',
        sheets: rows.length > 0 ? [{ sheetName: fileName, rows }] : [],
        detectedDelimiter: delimiter,
        detectedEncoding: encoding,
        errorMessage: rows.length === 0 ? 'الملف النصي فارغ.' : undefined,
      };
    }

    if (kind === 'html') {
      const { text, encoding } = decodeArabicTextBuffer(bytes);
      const sheets = parseHtmlTablesToSheets(text);
      return {
        ok: sheets.length > 0,
        fileKind: 'html',
        sheets,
        detectedEncoding: encoding,
        errorMessage:
          sheets.length === 0 ? 'لم يتم العثور على جداول <table> داخل ملف HTML.' : undefined,
      };
    }

    if (kind === 'markdown') {
      const { text, encoding } = decodeArabicTextBuffer(bytes);
      const rows = parseMarkdownTablesToRows(text);
      return {
        ok: rows.length > 0,
        fileKind: 'markdown',
        sheets: rows.length > 0 ? [{ sheetName: fileName, rows }] : [],
        detectedEncoding: encoding,
        errorMessage: rows.length === 0 ? 'لم يتم العثور على جدول Markdown.' : undefined,
      };
    }

    if (kind === 'docx') {
      const sheets = await extractDocxTables(bytes);
      return {
        ok: sheets.length > 0,
        fileKind: 'docx',
        sheets,
        errorMessage:
          sheets.length === 0
            ? 'لم يتم العثور على جداول داخل ملف Word (.docx).'
            : undefined,
      };
    }

    if (kind === 'pdf') {
      const pdfRes = await extractPdfTextTables(bytes);
      return {
        ok: true,
        fileKind: 'pdf',
        sheets: pdfRes.sheets,
        requiresOcr: pdfRes.requiresOcr,
      };
    }

    if (kind === 'json') {
      const { text } = decodeArabicTextBuffer(bytes);
      const parsed = JSON.parse(text);
      // Check if it's a full backup
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.operations) && parsed.daysMap) {
        const ops: any[] = parsed.operations;
        const headers = ['التاريخ', 'النوع', 'العيار', 'الوزن', 'المبلغ', 'البيان', 'الدفع', 'ملاحظة'];
        const rows: string[][] = [
          headers,
          ...ops.map((o) => [
            String(o.date || ''),
            String(o.kind || 'sell'),
            String(o.karat || 21),
            String(o.weightG ?? 0),
            String(o.total ?? 0),
            String(o.item || o.category || ''),
            String(o.payment || 'cash'),
            String(o.note || ''),
          ]),
        ];
        return {
          ok: true,
          fileKind: 'json',
          sheets: [{ sheetName: 'العمليات من JSON', rows }],
          isFullJsonBackup: true,
          jsonBackupPayload: parsed,
        };
      }
      // Or exported JSON table with `rows` array
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rows)
        ? parsed.rows
        : Array.isArray(parsed?.operations)
        ? parsed.operations
        : [];
      if (arr.length > 0 && typeof arr[0] === 'object') {
        const keys = Object.keys(arr[0]);
        const rows: string[][] = [
          keys,
          ...arr.map((item: any) => keys.map((k) => String(item[k] ?? ''))),
        ];
        return {
          ok: true,
          fileKind: 'json',
          sheets: [{ sheetName: fileName, rows }],
        };
      }
      return {
        ok: false,
        fileKind: 'json',
        sheets: [],
        errorMessage: 'ملف JSON لا يحتوي على مصفوفة عمليات صالحة.',
      };
    }

    if (kind === 'zip') {
      const zip = await JSZip.loadAsync(bytes);
      const combinedSheets: ExtractedSheetTable[] = [];
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      for (const entry of entries) {
        const subBytes = await entry.async('uint8array');
        const subType = detectImportFileType(entry.name, subBytes);
        if (subType.ok && subType.fileKind !== 'zip' && subType.fileKind !== 'image') {
          const subRes = await extractRawTablesFromFile(
            entry.name,
            subBytes,
            subType.fileKind
          );
          if (subRes.ok && subRes.sheets.length > 0) {
            for (const sh of subRes.sheets) {
              combinedSheets.push({
                sheetName: `${entry.name} (${sh.sheetName})`,
                rows: sh.rows,
              });
            }
          }
        }
      }
      return {
        ok: combinedSheets.length > 0,
        fileKind: 'zip',
        sheets: combinedSheets,
        errorMessage:
          combinedSheets.length === 0
            ? 'الأرشيف المضغوط (.zip) لا يحتوي على ملفات جداول مدعومة.'
            : undefined,
      };
    }

    return {
      ok: false,
      fileKind: 'unknown',
      sheets: [],
      errorMessage: 'تعذر استخراج جدول من الملف.',
    };
  } catch (err: any) {
    return {
      ok: false,
      fileKind: kind,
      sheets: [],
      errorMessage: err?.message || 'حدث خطأ أثناء قراءة الملف.',
    };
  }
}
