export type DetectedImportFileKind =
  | 'image'
  | 'pdf'
  | 'excel'
  | 'csv'
  | 'docx'
  | 'html'
  | 'markdown'
  | 'json'
  | 'zip'
  | 'unknown';

export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

export interface DetectedFileResult {
  ok: boolean;
  fileKind: DetectedImportFileKind;
  fileName: string;
  sizeBytes: number;
  fileHash: string;
  errorCode?: 'E-IMPORT-010' | 'E-IMPORT-011';
  errorMessage?: string;
}

/**
 * Computes a fast deterministic hash of a file buffer/size/name to detect re-importing the exact same file.
 */
export function computeBufferQuickHash(
  bytes: Uint8Array,
  fileName: string
): string {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `${fileName}-${bytes.length}-${(hash >>> 0).toString(16)}`;
}

/**
 * G3.1 & G3.2 (Step 1): Detects file type using magic bytes + file extension and enforces the 50MB limit.
 */
export function detectImportFileType(
  fileName: string,
  bytes: Uint8Array
): DetectedFileResult {
  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      fileKind: 'unknown',
      fileName,
      sizeBytes: bytes.byteLength,
      fileHash: '',
      errorCode: 'E-IMPORT-011',
      errorMessage: `حجم الملف (${(bytes.byteLength / (1024 * 1024)).toFixed(
        1
      )} MB) يتجاوز الحد الأقصى المسموح به (50 ميجابايت).`,
    };
  }

  const fileHash = computeBufferQuickHash(bytes, fileName);
  const ext = (fileName.split('.').pop() || '').toLowerCase().trim();

  // Check magic bytes
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  const b3 = bytes[3] ?? 0;

  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) {
    return { ok: true, fileKind: 'pdf', fileName, sizeBytes: bytes.byteLength, fileHash };
  }

  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) {
    return { ok: true, fileKind: 'image', fileName, sizeBytes: bytes.byteLength, fileHash };
  }

  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
    return { ok: true, fileKind: 'image', fileName, sizeBytes: bytes.byteLength, fileHash };
  }

  // ZIP / XLSX / DOCX / ODS: 50 4B 03 04 (PK..)
  if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) {
    if (ext === 'docx') {
      return { ok: true, fileKind: 'docx', fileName, sizeBytes: bytes.byteLength, fileHash };
    }
    if (ext === 'xlsx' || ext === 'xlsm' || ext === 'ods') {
      return { ok: true, fileKind: 'excel', fileName, sizeBytes: bytes.byteLength, fileHash };
    }
    if (ext === 'zip') {
      return { ok: true, fileKind: 'zip', fileName, sizeBytes: bytes.byteLength, fileHash };
    }
    return { ok: true, fileKind: 'excel', fileName, sizeBytes: bytes.byteLength, fileHash };
  }

  // Legacy XLS (OLE2 Compound Document: D0 CF 11 E0)
  if (b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0) {
    return { ok: true, fileKind: 'excel', fileName, sizeBytes: bytes.byteLength, fileHash };
  }

  // Extension fallbacks
  if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'heic'].includes(ext)) {
    return { ok: true, fileKind: 'image', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (ext === 'pdf') {
    return { ok: true, fileKind: 'pdf', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) {
    return { ok: true, fileKind: 'excel', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (ext === 'docx') {
    return { ok: true, fileKind: 'docx', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (ext === 'zip') {
    return { ok: true, fileKind: 'zip', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (ext === 'json') {
    return { ok: true, fileKind: 'json', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (ext === 'html' || ext === 'htm') {
    return { ok: true, fileKind: 'html', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (ext === 'md' || ext === 'markdown') {
    return { ok: true, fileKind: 'markdown', fileName, sizeBytes: bytes.byteLength, fileHash };
  }
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    return { ok: true, fileKind: 'csv', fileName, sizeBytes: bytes.byteLength, fileHash };
  }

  return {
    ok: false,
    fileKind: 'unknown',
    fileName,
    sizeBytes: bytes.byteLength,
    fileHash,
    errorCode: 'E-IMPORT-010',
    errorMessage: `صيغة الملف (${fileName}) غير معروفة أو غير مدعومة.`,
  };
}
