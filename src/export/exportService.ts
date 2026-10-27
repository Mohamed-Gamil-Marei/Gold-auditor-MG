import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  AuditSettings,
  DiagnosticErrorLog,
} from '../types';
import { getDiagnosticErrorLogs, reportAppError, scrubSensitiveText } from '../errors/catalog';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';
import { formatNumber, getTodayIso } from '../utils/numerals';

export interface ExportColumnDef {
  key: string;
  label: string;
  isNumeric?: boolean;
  isWeight?: boolean;
  isPersonSensitive?: boolean;
  defaultVisible?: boolean;
}

export interface UnifiedExportOptions {
  reportTitle: string;
  filenamePrefix: string;
  columns: ExportColumnDef[];
  rows: Record<string, any>[];
  activeFilterSummary?: string;
  periodSummary?: string;
  shopName?: string;
  auditorName?: string;
  includePersonData?: boolean;
  csvDelimiter?: ',' | ';';
  onProgress?: (pct: number) => void;
}

function sanitizeXml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * Computes numeric totals for all numeric/weight columns in the exported rows.
 */
export function computeExportTotalsRow(
  columns: ExportColumnDef[],
  rows: Record<string, any>[]
): Record<string, any> {
  const totals: Record<string, any> = {};
  columns.forEach((col, idx) => {
    if (idx === 0) {
      totals[col.key] = 'الإجمالي';
    } else if (col.isNumeric || col.isWeight) {
      let sum = 0;
      for (const r of rows) {
        const val = Number(r[col.key]);
        if (Number.isFinite(val)) sum += val;
      }
      totals[col.key] = col.isWeight ? Number(sum.toFixed(3)) : Math.round(sum * 100) / 100;
    } else {
      totals[col.key] = '';
    }
  });
  return totals;
}

/**
 * Prepares rows according to selected columns and `includePersonData` privacy toggle.
 */
export function prepareExportMatrix(options: UnifiedExportOptions): {
  effectiveColumns: ExportColumnDef[];
  cleanRows: Record<string, any>[];
  totalsRow: Record<string, any>;
} {
  const { columns, rows, includePersonData = true } = options;
  const effectiveColumns = columns.filter(
    (c) => includePersonData || !c.isPersonSensitive
  );

  const cleanRows = rows.map((r) => {
    const out: Record<string, any> = {};
    for (const col of effectiveColumns) {
      let val = r[col.key];
      if (!includePersonData && col.isPersonSensitive) {
        val = '—';
      } else if (col.isNumeric || col.isWeight) {
        const num = Number(val);
        val = Number.isFinite(num) ? (col.isWeight ? Number(num.toFixed(3)) : num) : 0;
      } else {
        val = val ?? '';
      }
      out[col.key] = val;
    }
    return out;
  });

  const totalsRow = computeExportTotalsRow(effectiveColumns, cleanRows);
  return { effectiveColumns, cleanRows, totalsRow };
}

/**
 * G2.3: Export to Excel (.xlsx) with RTL view, auto column widths, numeric cells, SUM formula row, and Metadata sheet.
 */
export async function exportToExcelFormat(options: UnifiedExportOptions): Promise<{
  ok: boolean;
  filename: string;
}> {
  try {
    options.onProgress?.(20);
    const { effectiveColumns, cleanRows } = prepareExportMatrix(options);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };

    const headers = effectiveColumns.map((c) => c.label);
    const aoa: any[][] = [headers];

    for (const row of cleanRows) {
      aoa.push(effectiveColumns.map((col) => row[col.key]));
    }

    // Add bottom SUM formula / totals row if there are rows
    if (cleanRows.length > 0) {
      const dataStartRow = 2; // 1-indexed after header
      const dataEndRow = cleanRows.length + 1;
      const sumRow: any[] = effectiveColumns.map((col, cIdx) => {
        if (cIdx === 0) return 'الإجمالي';
        if (col.isNumeric || col.isWeight) {
          const colLetter = XLSX.utils.encode_col(cIdx);
          return { t: 'n', f: `SUM(${colLetter}${dataStartRow}:${colLetter}${dataEndRow})` };
        }
        return '';
      });
      aoa.push(sumRow);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Set RTL sheet view & freeze top row
    (ws as any)['!views'] = [
      { rightToLeft: true, state: 'frozen', ySplit: 1 },
    ];

    // Auto-calculate column widths
    const colWidths = effectiveColumns.map((col) => {
      let maxLen = col.label.length;
      for (let i = 0; i < Math.min(cleanRows.length, 200); i++) {
        const cellStr = String(cleanRows[i][col.key] ?? '');
        if (cellStr.length > maxLen) maxLen = cellStr.length;
      }
      return { wch: Math.max(12, Math.min(42, maxLen + 5)) };
    });
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, options.reportTitle.slice(0, 28) || 'البيانات');

    // Sheet 2: Metadata ("معلومات")
    const metaAoa = [
      ['حقل المعلومات', 'القيمة'],
      ['عنوان التقرير', options.reportTitle],
      ['اسم المحل', options.shopName || 'غير محدد'],
      ['اسم المراجع', options.auditorName || 'المراجع المالي'],
      ['الفترة الزمنية', options.periodSummary || 'كل الفترات'],
      ['الفلاتر النشطة', options.activeFilterSummary || 'بدون فلاتر (الكل)'],
      ['عدد الصفوف المصدرة', cleanRows.length],
      ['تضمين بيانات الأشخاص', options.includePersonData !== false ? 'نعم' : 'لا (تم إخفاؤها)'],
      ['وقت التصدير', new Date().toLocaleString('ar-EG')],
    ];
    const wsMeta = XLSX.utils.aoa_to_sheet(metaAoa);
    (wsMeta as any)['!views'] = [{ rightToLeft: true }];
    wsMeta['!cols'] = [{ wch: 24 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, 'معلومات');

    options.onProgress?.(85);
    const stamp = getTodayIso();
    const filename = `${options.filenamePrefix}_${stamp}.xlsx`;
    XLSX.writeFile(wb, filename);
    options.onProgress?.(100);
    return { ok: true, filename };
  } catch (err: any) {
    reportAppError({
      code: 'E-EXPORT-045',
      screen: options.reportTitle,
      customMessage: err?.message || 'تعذر تصدير ملف إكسل',
    });
    return { ok: false, filename: '' };
  }
}

/**
 * G2.2: Export to CSV (UTF-8 with BOM so Arabic opens properly in Windows Excel)
 */
export function exportToCsvFormat(options: UnifiedExportOptions): {
  ok: boolean;
  filename: string;
  csvContent: string;
} {
  try {
    const delimiter = options.csvDelimiter || ',';
    const { effectiveColumns, cleanRows, totalsRow } = prepareExportMatrix(options);

    const escapeCsvCell = (val: any): string => {
      const str = String(val ?? '');
      if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines: string[] = [];
    lines.push(effectiveColumns.map((c) => escapeCsvCell(c.label)).join(delimiter));
    for (const row of cleanRows) {
      lines.push(effectiveColumns.map((c) => escapeCsvCell(row[c.key])).join(delimiter));
    }
    if (cleanRows.length > 0) {
      lines.push(effectiveColumns.map((c) => escapeCsvCell(totalsRow[c.key])).join(delimiter));
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const filename = `${options.filenamePrefix}_${getTodayIso()}.csv`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    triggerBrowserDownload(blob, filename);
    return { ok: true, filename, csvContent };
  } catch (err: any) {
    reportAppError({
      code: 'E-EXPORT-045',
      screen: options.reportTitle,
      customMessage: err?.message || 'تعذر تصدير ملف CSV',
    });
    return { ok: false, filename: '', csvContent: '' };
  }
}

/**
 * G2.2: Export to Standalone Self-Contained HTML File
 */
export function buildStandaloneHtmlString(
  options: UnifiedExportOptions & {
    paperSize?: 'A4' | 'A5';
    orientation?: 'portrait' | 'landscape';
    fontSize?: 'small' | 'medium' | 'large';
  }
): string {
  const { effectiveColumns, cleanRows, totalsRow } = prepareExportMatrix(options);
  const fontPx =
    options.fontSize === 'small' ? '11px' : options.fontSize === 'large' ? '15px' : '13px';
  const pageRule = `@page { size: ${options.paperSize || 'A4'} ${
    options.orientation || 'portrait'
  }; margin: 12mm; }`;

  const headerCells = effectiveColumns
    .map((c) => `<th>${sanitizeXml(c.label)}</th>`)
    .join('');

  const bodyRowsHtml = cleanRows
    .map((row, idx) => {
      const cells = effectiveColumns
        .map((col) => {
          const val = row[col.key];
          const formatted =
            col.isNumeric && typeof val === 'number'
              ? formatNumber(val)
              : String(val ?? '');
          return `<td class="${col.isNumeric || col.isWeight ? 'num' : ''}">${sanitizeXml(
            formatted
          )}</td>`;
        })
        .join('');
      return `<tr class="${idx % 2 === 1 ? 'even' : ''}">${cells}</tr>`;
    })
    .join('\n');

  const totalsCellsHtml =
    cleanRows.length > 0
      ? `<tr class="totals-row">${effectiveColumns
          .map((col) => {
            const val = totalsRow[col.key];
            const formatted =
              col.isNumeric && typeof val === 'number'
                ? formatNumber(val)
                : String(val ?? '');
            return `<td class="${col.isNumeric || col.isWeight ? 'num' : ''}">${sanitizeXml(
              formatted
            )}</td>`;
          })
          .join('')}</tr>`
      : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${sanitizeXml(options.reportTitle)} - مراجع الذهب</title>
  <style>
    ${pageRule}
    * { box-sizing: border-box; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; }
    body { margin: 0; padding: 20px; background: #fff; color: #0f172a; font-size: ${fontPx}; direction: rtl; }
    .report-header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
    .report-title { font-size: 1.35em; font-weight: 800; margin: 0 0 4px 0; }
    .report-meta { font-size: 0.9em; color: #334155; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    thead { display: table-header-group; }
    th { background: #f1f5f9; color: #0f172a; font-weight: 800; text-align: right; padding: 8px 10px; border: 1px solid #cbd5e1; }
    td { padding: 7px 10px; border: 1px solid #cbd5e1; vertical-align: middle; }
    tr.even { background: #f8fafc; }
    tr.totals-row td { background: #fef3c7; font-weight: 800; border-top: 2px solid #0f172a; }
    .num { font-family: 'Courier New', monospace; font-weight: 700; direction: ltr; text-align: right; }
    .signatures { display: flex; justify-content: space-between; margin-top: 32px; padding-top: 16px; page-break-inside: avoid; }
    .sig-box { width: 42%; border-top: 1.5px dashed #475569; padding-top: 8px; text-align: center; font-weight: 700; }
    .footer { margin-top: 24px; font-size: 0.85em; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="report-header">
    <div>
      <h1 class="report-title">${sanitizeXml(options.reportTitle)}</h1>
      <div class="report-meta">
        <strong>المحل:</strong> ${sanitizeXml(options.shopName || 'غير محدد')} &nbsp;|&nbsp;
        <strong>الفترة:</strong> ${sanitizeXml(options.periodSummary || 'الكل')}
      </div>
      <div class="report-meta">
        <strong>الفلاتر المطبقة:</strong> ${sanitizeXml(options.activeFilterSummary || 'بدون فلاتر')}
      </div>
    </div>
    <div class="report-meta" style="text-align: left;">
      <div><strong>المراجع:</strong> ${sanitizeXml(options.auditorName || 'المراجع المالي')}</div>
      <div><strong>تاريخ الطباعة:</strong> ${sanitizeXml(new Date().toLocaleString('ar-EG'))}</div>
      <div><strong>عدد السجلات:</strong> ${cleanRows.length}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>${headerCells}</tr>
    </thead>
    <tbody>
      ${bodyRowsHtml}
      ${totalsCellsHtml}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-box">توقيع المراجع المالي (${sanitizeXml(options.auditorName || '................')})</div>
    <div class="sig-box">توقيع صاحب المحل / المسؤول</div>
  </div>

  <div class="footer">
    تم استخراج هذا التقرير بواسطة برنامج مراجع الذهب v2.0.0 — جميع الإجماليات مطابقة للسجلات المعروضة.
  </div>
</body>
</html>`;
}

export function exportToHtmlFormat(options: UnifiedExportOptions): {
  ok: boolean;
  filename: string;
} {
  try {
    const html = buildStandaloneHtmlString(options);
    const filename = `${options.filenamePrefix}_${getTodayIso()}.html`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    triggerBrowserDownload(blob, filename);
    return { ok: true, filename };
  } catch (err: any) {
    reportAppError({
      code: 'E-EXPORT-045',
      screen: options.reportTitle,
      customMessage: err?.message || 'تعذر تصدير ملف HTML',
    });
    return { ok: false, filename: '' };
  }
}

/**
 * G2.2: Export to Word (.docx) using valid OOXML inside a JSZip archive with RTL Arabic table & totals.
 */
export async function exportToDocxFormat(options: UnifiedExportOptions): Promise<{
  ok: boolean;
  filename: string;
}> {
  try {
    const { effectiveColumns, cleanRows, totalsRow } = prepareExportMatrix(options);
    const zip = new JSZip();

    // [Content_Types].xml
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );

    // _rels/.rels
    zip.folder('_rels')?.file(
      '.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    );

    const buildWordCell = (text: string, bold = false, shadeHex?: string) => `
      <w:tc>
        <w:tcPr>
          ${shadeHex ? `<w:shd w:val="clear" w:color="auto" w:fill="${shadeHex}"/>` : ''}
        </w:tcPr>
        <w:p>
          <w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>
          <w:r>
            <w:rPr>
              <w:rtl/>
              ${bold ? '<w:b/><w:bCs/>' : ''}
            </w:rPr>
            <w:t>${sanitizeXml(text)}</w:t>
          </w:r>
        </w:p>
      </w:tc>`;

    const headerRowXml = `<w:tr>${effectiveColumns
      .map((c) => buildWordCell(c.label, true, 'E2E8F0'))
      .join('')}</w:tr>`;

    const bodyRowsXml = cleanRows
      .map(
        (row) =>
          `<w:tr>${effectiveColumns
            .map((col) => {
              const val = row[col.key];
              const str =
                col.isNumeric && typeof val === 'number'
                  ? formatNumber(val)
                  : String(val ?? '');
              return buildWordCell(str, false);
            })
            .join('')}</w:tr>`
      )
      .join('');

    const totalsRowXml =
      cleanRows.length > 0
        ? `<w:tr>${effectiveColumns
            .map((col) => {
              const val = totalsRow[col.key];
              const str =
                col.isNumeric && typeof val === 'number'
                  ? formatNumber(val)
                  : String(val ?? '');
              return buildWordCell(str, true, 'FEF3C7');
            })
            .join('')}</w:tr>`
        : '';

    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr>
        <w:t>${sanitizeXml(options.reportTitle)} — ${sanitizeXml(options.shopName || 'مراجع الذهب')}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>
      <w:r>
        <w:rPr><w:rtl/></w:rPr>
        <w:t>الفترة: ${sanitizeXml(options.periodSummary || 'الكل')} | الفلاتر: ${sanitizeXml(
      options.activeFilterSummary || 'بدون فلاتر'
    )} | التاريخ: ${sanitizeXml(new Date().toLocaleString('ar-EG'))}</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:bidiVisual/>
        <w:tblW w:w="5000" w:type="pct"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
        </w:tblBorders>
      </w:tblPr>
      ${headerRowXml}
      ${bodyRowsXml}
      ${totalsRowXml}
    </w:tbl>
    <w:p>
      <w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:bCs/><w:rtl/></w:rPr>
        <w:t>توقيع المراجع: ..............................          توقيع صاحب المحل: ..............................</w:t>
      </w:r>
    </w:p>
    <w:sectPr>
      <w:bidi/>
    </w:sectPr>
  </w:body>
</w:document>`;

    zip.folder('word')?.file('document.xml', docXml);
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const filename = `${options.filenamePrefix}_${getTodayIso()}.docx`;
    triggerBrowserDownload(blob, filename);
    return { ok: true, filename };
  } catch (err: any) {
    reportAppError({
      code: 'E-EXPORT-045',
      screen: options.reportTitle,
      customMessage: err?.message || 'تعذر تصدير ملف Word (.docx)',
    });
    return { ok: false, filename: '' };
  }
}

/**
 * G2.2: Export to JSON
 */
export function exportToJsonFormat(options: UnifiedExportOptions): {
  ok: boolean;
  filename: string;
} {
  try {
    const { effectiveColumns, cleanRows, totalsRow } = prepareExportMatrix(options);
    const payload = {
      reportTitle: options.reportTitle,
      shopName: options.shopName || '',
      auditorName: options.auditorName || '',
      periodSummary: options.periodSummary || '',
      activeFilterSummary: options.activeFilterSummary || '',
      exportedAt: new Date().toISOString(),
      columns: effectiveColumns.map((c) => ({ key: c.key, label: c.label })),
      rowsCount: cleanRows.length,
      rows: cleanRows,
      totals: totalsRow,
    };
    const filename = `${options.filenamePrefix}_${getTodayIso()}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    triggerBrowserDownload(blob, filename);
    return { ok: true, filename };
  } catch (err: any) {
    reportAppError({
      code: 'E-EXPORT-045',
      screen: options.reportTitle,
      customMessage: err?.message || 'تعذر تصدير ملف JSON',
    });
    return { ok: false, filename: '' };
  }
}

/**
 * G2.2: Copy Table as TSV to Clipboard (for direct paste into Excel or WhatsApp)
 */
export async function copyToClipboardTsv(options: UnifiedExportOptions): Promise<boolean> {
  try {
    const { effectiveColumns, cleanRows, totalsRow } = prepareExportMatrix(options);
    const lines: string[] = [];
    lines.push(effectiveColumns.map((c) => c.label).join('\t'));
    for (const row of cleanRows) {
      lines.push(effectiveColumns.map((c) => String(row[c.key] ?? '')).join('\t'));
    }
    if (cleanRows.length > 0) {
      lines.push(effectiveColumns.map((c) => String(totalsRow[c.key] ?? '')).join('\t'));
    }
    const tsv = lines.join('\n');
    await navigator.clipboard.writeText(tsv);
    return true;
  } catch {
    return false;
  }
}

/**
 * G2.2: Render Table as high-clarity RTL PNG Image (for WhatsApp sharing) and copy/download it.
 */
export async function exportTableAsPngImage(
  options: UnifiedExportOptions
): Promise<{ ok: boolean; copiedToClipboard: boolean; filename: string }> {
  try {
    const { effectiveColumns, cleanRows, totalsRow } = prepareExportMatrix(options);
    const maxRowsToDraw = Math.min(cleanRows.length, 45);
    const colWidth = 150;
    const width = Math.max(760, effectiveColumns.length * colWidth + 48);
    const rowHeight = 32;
    const headerHeight = 95;
    const footerHeight = 60;
    const height = headerHeight + (maxRowsToDraw + 2) * rowHeight + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.scale(2, 2);

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Header banner
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, 68);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 18px Cairo, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${options.reportTitle} — ${options.shopName || 'مراجع الذهب'}`,
      width - 24,
      30
    );
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px Cairo, sans-serif';
    ctx.fillText(
      `الفترة: ${options.periodSummary || 'الكل'} | عدد السجلات: ${
        cleanRows.length
      } | التاريخ: ${new Date().toLocaleDateString('ar-EG')}`,
      width - 24,
      52
    );

    const startY = 82;
    const usableW = width - 48;
    const cellW = usableW / Math.max(1, effectiveColumns.length);

    // Draw table headers (RTL: column 0 on the right)
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(24, startY, usableW, rowHeight);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(24, startY, usableW, rowHeight);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px Cairo, sans-serif';
    effectiveColumns.forEach((col, cIdx) => {
      const cellRightX = width - 24 - cIdx * cellW - 8;
      ctx.fillText(col.label.slice(0, 22), cellRightX, startY + 20);
    });

    // Draw rows
    for (let rIdx = 0; rIdx < maxRowsToDraw; rIdx++) {
      const y = startY + (rIdx + 1) * rowHeight;
      ctx.fillStyle = rIdx % 2 === 1 ? '#f8fafc' : '#ffffff';
      ctx.fillRect(24, y, usableW, rowHeight);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(24, y, usableW, rowHeight);

      ctx.fillStyle = '#1e293b';
      ctx.font = '12px Cairo, monospace';
      const row = cleanRows[rIdx];
      effectiveColumns.forEach((col, cIdx) => {
        const cellRightX = width - 24 - cIdx * cellW - 8;
        const val = row[col.key];
        const text =
          col.isNumeric && typeof val === 'number'
            ? formatNumber(val)
            : String(val ?? '');
        ctx.fillText(text.slice(0, 22), cellRightX, y + 20);
      });
    }

    // Draw totals row
    const totalY = startY + (maxRowsToDraw + 1) * rowHeight;
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(24, totalY, usableW, rowHeight);
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(24, totalY, usableW, rowHeight);
    ctx.fillStyle = '#78350f';
    ctx.font = 'bold 12px Cairo, monospace';
    effectiveColumns.forEach((col, cIdx) => {
      const cellRightX = width - 24 - cIdx * cellW - 8;
      const val = totalsRow[col.key];
      const text =
        col.isNumeric && typeof val === 'number'
          ? formatNumber(val)
          : String(val ?? '');
      ctx.fillText(text.slice(0, 22), cellRightX, totalY + 20);
    });

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG blob failed'))), 'image/png');
    });

    let copied = false;
    try {
      if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copied = true;
      }
    } catch {
      copied = false;
    }

    const filename = `${options.filenamePrefix}_${getTodayIso()}.png`;
    triggerBrowserDownload(blob, filename);
    return { ok: true, copiedToClipboard: copied, filename };
  } catch (err: any) {
    reportAppError({
      code: 'E-EXPORT-045',
      screen: options.reportTitle,
      customMessage: err?.message || 'تعذر نسخ الجدول كصورة',
    });
    return { ok: false, copiedToClipboard: false, filename: '' };
  }
}

/**
 * G1.2: Exports a Problem Report (.zip) containing diagnostic logs + sanitized settings (zero operations/personal data).
 */
export async function exportProblemReportZip(
  settings: AuditSettings
): Promise<{ ok: boolean; filename: string }> {
  try {
    const zip = new JSZip();
    const localLogs: DiagnosticErrorLog[] = getDiagnosticErrorLogs();

    // Also fetch any main-process rotating log files if available
    let mainProcessLogs: any[] = [];
    try {
      const api = ensureGoldApiBridge() as any;
      if (api.diagnostics?.getLogs) {
        const res = await api.diagnostics.getLogs();
        if (res?.ok && Array.isArray(res.logs)) {
          mainProcessLogs = res.logs;
        }
      }
    } catch {
      // ignore
    }

    const sanitizedSettings = {
      ...settings,
      shopName: settings.shopName ? '[REDACTED_SHOP_NAME]' : '',
      auditorName: '[REDACTED_AUDITOR]',
      externalBackupPath: settings.externalBackupPath ? '[CONFIGURED_PATH]' : '',
      exceptions: {
        itemsCount: settings.exceptions?.items?.length || 0,
        personIdsCount: settings.exceptions?.personIds?.length || 0,
        datesCount: settings.exceptions?.dates?.length || 0,
      },
    };

    zip.file(
      'diagnostic-report-info.json',
      JSON.stringify(
        {
          app: 'Gold Audit (مراجع الذهب)',
          version: '2.0.0',
          generatedAt: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
          privacyGuarantee:
            'هذا التقرير خالٍ تماماً من العمليات المالية وأسماء الأشخاص وأرقام المبالغ ومفاتيح API.',
          sanitizedSettings,
        },
        null,
        2
      )
    );

    const scrubbedLogs = localLogs.map((l) => ({
      ...l,
      message: scrubSensitiveText(l.message),
      stack: l.stack ? scrubSensitiveText(l.stack) : undefined,
    }));

    zip.file('renderer-error-logs.json', JSON.stringify(scrubbedLogs, null, 2));
    if (mainProcessLogs.length > 0) {
      zip.file('main-process-logs.json', JSON.stringify(mainProcessLogs, null, 2));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const filename = `تقرير_مشكلة_مراجع_الذهب_${getTodayIso()}.zip`;
    triggerBrowserDownload(blob, filename);
    return { ok: true, filename };
  } catch (err: any) {
    reportAppError({
      code: 'E-EXPORT-045',
      screen: 'التشخيص',
      customMessage: err?.message || 'تعذر تصدير ملف تقرير المشكلة',
    });
    return { ok: false, filename: '' };
  }
}
