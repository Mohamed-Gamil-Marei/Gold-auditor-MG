import { LedgerPageRegion } from '../types';

export interface PreprocessOptions {
  rotationDeg?: 0 | 90 | 180 | 270;
  region?: { x: number; y: number; w: number; h: number }; // 0..1 relative coordinates
  preset?: 'standard' | 'low_quality_boost' | 'color_preserve';
  maxDimensionPx?: number; // default 2400 (H2.4)
  marginCropPct?: number; // P2: e.g. 0.03 (3% border crop to remove fingers/black margins)
  upscaleLowRes?: boolean; // P2: upscale small images < 1200px
}

export interface PreprocessResult {
  processedBase64: string;
  processedDataUrl: string;
  colorDataUrl: string;
  width: number;
  height: number;
  imageHash: string;
}

// H2.6: In-memory cache of preprocessed images keyed by hash + options
const preprocessCache = new Map<string, PreprocessResult>();

/**
 * Computes a fast deterministic hash for an image dataUrl or base64 string (H2.6 & P1)
 */
export function computeImageHash(dataUrlOrBase64: string): string {
  const str = dataUrlOrBase64 || '';
  const len = str.length;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const step = Math.max(1, Math.floor(len / 4096));
  for (let i = 0; i < len; i += step) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `img-${len.toString(36)}-${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

/**
 * Default regions for a standard two-half ledger page (Right = Sell, Left = Buy)
 * and H-C two-block structure per sheet (Block 1 = Right, Block 2 = Left).
 */
export function getDefaultLedgerRegions(
  mode:
    | 'both_split'
    | 'two_blocks_per_sheet'
    | 'right_sell'
    | 'left_buy'
    | 'full'
    | 'top_bottom_sheets',
  reverseLayout = false
): LedgerPageRegion[] {
  const rightSide: 'sell' | 'buy' = reverseLayout ? 'buy' : 'sell';
  const leftSide: 'sell' | 'buy' = reverseLayout ? 'sell' : 'buy';
  const rightLabel = rightSide === 'sell' ? 'المبيعات' : 'المشتريات';
  const leftLabel = leftSide === 'sell' ? 'المبيعات' : 'المشتريات';

  if (mode === 'two_blocks_per_sheet') {
    return [
      {
        id: 'reg-right-b1',
        label: `ورقة ${rightLabel} (يمين) — الكتلة اليمنى (1)`,
        side: rightSide,
        blockIndex: 1,
        x: 0.74,
        y: 0,
        w: 0.26,
        h: 1,
      },
      {
        id: 'reg-right-b2',
        label: `ورقة ${rightLabel} (يمين) — الكتلة اليسرى (2)`,
        side: rightSide,
        blockIndex: 2,
        x: 0.49,
        y: 0,
        w: 0.26,
        h: 1,
      },
      {
        id: 'reg-left-b1',
        label: `ورقة ${leftLabel} (يسار) — الكتلة اليمنى (1)`,
        side: leftSide,
        blockIndex: 1,
        x: 0.25,
        y: 0,
        w: 0.26,
        h: 1,
      },
      {
        id: 'reg-left-b2',
        label: `ورقة ${leftLabel} (يسار) — الكتلة اليسرى (2)`,
        side: leftSide,
        blockIndex: 2,
        x: 0,
        y: 0,
        w: 0.26,
        h: 1,
      },
    ];
  }
  if (mode === 'right_sell') {
    return [
      { id: 'reg-sell', label: `نصف ${rightLabel} الأيمن`, side: rightSide, x: 0.48, y: 0, w: 0.52, h: 1 },
    ];
  }
  if (mode === 'left_buy') {
    return [
      { id: 'reg-buy', label: `نصف ${leftLabel} الأيسر`, side: leftSide, x: 0, y: 0, w: 0.52, h: 1 },
    ];
  }
  if (mode === 'top_bottom_sheets') {
    return [
      { id: 'reg-top', label: `الورقة العلوية (${rightLabel})`, side: rightSide, x: 0, y: 0, w: 1, h: 0.52 },
      { id: 'reg-bottom', label: `الورقة السفلية (${leftLabel})`, side: leftSide, x: 0, y: 0.48, w: 1, h: 0.52 },
    ];
  }
  if (mode === 'full') {
    return [
      { id: 'reg-full', label: 'الصفحة كاملة', side: 'both', x: 0, y: 0, w: 1, h: 1 },
    ];
  }
  return [
    { id: 'reg-sell', label: `نصف ${rightLabel} الأيمن`, side: rightSide, x: 0.48, y: 0, w: 0.52, h: 1 },
    { id: 'reg-buy', label: `نصف ${leftLabel} الأيسر`, side: leftSide, x: 0, y: 0, w: 0.52, h: 1 },
  ];
}

/**
 * H2.3 & P2: Applies grayscale/contrast enhancement, shadow normalization, and black-ink boost
 * while optionally keeping red ink discernible.
 */
function applyPixelEnhancement(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: 'standard' | 'low_quality_boost' | 'color_preserve'
) {
  if (preset === 'color_preserve') return;

  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Sample luminance percentiles for adaptive contrast stretching & shadow removal
    let minLum = 255;
    let maxLum = 0;
    const sampleStep = Math.max(4, Math.floor(data.length / 4 / 8000) * 4);
    for (let i = 0; i < data.length; i += sampleStep) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }

    const range = Math.max(40, maxLum - minLum);
    const isBoost = preset === 'low_quality_boost';

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Detect strong red ink (H2.3 & P2: preserve red ink so H5 red marks stay visible!)
      const redness = r - Math.max(g, b);
      if (redness > 32 && r > 95) {
        if (isBoost) {
          // Strengthen red mark clarity slightly on washed-out paper
          data[i] = Math.min(255, Math.round(r * 1.1));
          data[i + 1] = Math.max(0, Math.round(g * 0.75));
          data[i + 2] = Math.max(0, Math.round(b * 0.75));
        }
        continue;
      }

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      let norm = ((lum - minLum) / range) * 255;

      if (isBoost) {
        // P2: Shadow removal (brighten paper background > 165) & strengthen black ink (< 130)
        if (norm > 168) {
          norm = Math.min(255, 220 + (norm - 168) * 0.4);
        } else if (norm < 135) {
          norm = Math.max(0, norm * 0.68);
        } else {
          norm = 135 + (norm - 135) * 2.4;
        }
      } else {
        // H2.3: Gentle contrast & illumination normalization
        if (norm > 185) {
          norm = Math.min(255, 210 + (norm - 185) * 0.6);
        } else if (norm < 120) {
          norm = Math.max(0, norm * 0.85);
        }
      }

      const clamped = Math.max(0, Math.min(255, Math.round(norm)));
      data[i] = clamped;
      data[i + 1] = clamped;
      data[i + 2] = clamped;
    }

    ctx.putImageData(imgData, 0, 0);
  } catch {
    // Ignore pixel manipulation errors in restricted canvas environments
  }
}

/**
 * H2 & P2: Preprocesses a ledger page image (rotation, margin crop, region crop, upscale/downscale to max 2400px,
 * keeping a color copy for H5 and an enhanced copy for OCR).
 */
export async function preprocessLedgerImage(
  sourceDataUrl: string,
  options: PreprocessOptions = {}
): Promise<PreprocessResult> {
  const imageHash = computeImageHash(sourceDataUrl);
  const rot = options.rotationDeg || 0;
  const reg = options.region || { x: 0, y: 0, w: 1, h: 1 };
  const preset = options.preset || 'standard';
  const maxDim = options.maxDimensionPx || 2400;
  const marginCrop = options.marginCropPct || (preset === 'low_quality_boost' ? 0.025 : 0);
  const upscale = options.upscaleLowRes ?? preset === 'low_quality_boost';

  const cacheKey = `${imageHash}|${rot}|${reg.x.toFixed(3)},${reg.y.toFixed(3)},${reg.w.toFixed(3)},${reg.h.toFixed(3)}|${preset}|${marginCrop}|${upscale}`;
  const cached = preprocessCache.get(cacheKey);
  if (cached) return cached;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const rad = (rot * Math.PI) / 180;
        const swapDims = rot % 180 !== 0;
        const rotW = swapDims ? img.height : img.width;
        const rotH = swapDims ? img.width : img.height;

        const rotCanvas = document.createElement('canvas');
        rotCanvas.width = rotW;
        rotCanvas.height = rotH;
        const rCtx = rotCanvas.getContext('2d');
        if (!rCtx) return reject(new Error('Canvas context unavailable'));

        rCtx.translate(rotW / 2, rotH / 2);
        rCtx.rotate(rad);
        rCtx.drawImage(img, -img.width / 2, -img.height / 2);

        // Apply region + optional margin trim (P2)
        const effX = Math.min(0.95, Math.max(0, reg.x + reg.w * marginCrop));
        const effY = Math.min(0.95, Math.max(0, reg.y + reg.h * marginCrop));
        const effW = Math.max(0.05, reg.w * (1 - marginCrop * 2));
        const effH = Math.max(0.05, reg.h * (1 - marginCrop * 2));

        const sx = Math.floor(rotW * effX);
        const sy = Math.floor(rotH * effY);
        const sw = Math.max(1, Math.floor(rotW * effW));
        const sh = Math.max(1, Math.floor(rotH * effH));

        const longestSide = Math.max(sw, sh);
        let scale = 1;
        if (longestSide > maxDim) {
          scale = maxDim / longestSide;
        } else if (upscale && longestSide < 1400) {
          scale = Math.min(1.6, 1800 / Math.max(1, longestSide));
        }

        const outW = Math.max(1, Math.round(sw * scale));
        const outH = Math.max(1, Math.round(sh * scale));

        // 1. Color copy for H5 red marks & P5 visual viewer
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = outW;
        colorCanvas.height = outH;
        const cCtx = colorCanvas.getContext('2d');
        if (!cCtx) return reject(new Error('Color canvas context unavailable'));
        cCtx.imageSmoothingEnabled = true;
        cCtx.imageSmoothingQuality = 'high';
        cCtx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
        const colorDataUrl = colorCanvas.toDataURL('image/jpeg', 0.84);

        // 2. Enhanced copy for OCR
        const procCanvas = document.createElement('canvas');
        procCanvas.width = outW;
        procCanvas.height = outH;
        const pCtx = procCanvas.getContext('2d');
        if (!pCtx) return reject(new Error('Processed canvas context unavailable'));
        pCtx.imageSmoothingEnabled = true;
        pCtx.imageSmoothingQuality = 'high';
        pCtx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, outW, outH);

        applyPixelEnhancement(pCtx, outW, outH, preset);

        const processedDataUrl = procCanvas.toDataURL('image/jpeg', 0.86);
        const processedBase64 = processedDataUrl.split(',')[1] || '';

        const result: PreprocessResult = {
          processedBase64,
          processedDataUrl,
          colorDataUrl,
          width: outW,
          height: outH,
          imageHash,
        };

        // Keep cache bounded to 60 entries
        if (preprocessCache.size > 60) {
          const firstKey = preprocessCache.keys().next().value;
          if (firstKey) preprocessCache.delete(firstKey);
        }
        preprocessCache.set(cacheKey, result);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('تعذر تحميل الصورة للتجهيز'));
    img.src = sourceDataUrl;
  });
}

/**
 * P4: Crops a small horizontal strip around a weak row/cell (`confidence < 0.7`)
 * so multiple weak cells can be verified in a single batched Gemini call.
 */
export async function cropWeakRowStripBase64(
  sourceDataUrl: string,
  rotationDeg: number,
  side: 'buy' | 'sell',
  yRatio: number
): Promise<string> {
  const safeY = Number.isFinite(yRatio) && yRatio > 0 && yRatio < 1 ? yRatio : 0.5;
  const stripTop = Math.max(0, safeY - 0.055);
  const stripHeight = Math.min(1 - stripTop, 0.11);
  const region =
    side === 'sell'
      ? { x: 0.47, y: stripTop, w: 0.53, h: stripHeight }
      : { x: 0, y: stripTop, w: 0.53, h: stripHeight };

  const res = await preprocessLedgerImage(sourceDataUrl, {
    rotationDeg: (rotationDeg as 0 | 90 | 180 | 270) || 0,
    region,
    preset: 'low_quality_boost',
    maxDimensionPx: 1200,
    upscaleLowRes: true,
  });
  return res.processedBase64;
}

export function clearPreprocessCache(): void {
  preprocessCache.clear();
}
