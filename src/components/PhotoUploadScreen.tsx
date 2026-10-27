import React, { useState, useRef, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Camera,
  RotateCw,
  Scissors,
  ZoomIn,
  ZoomOut,
  CheckCircle2,
  AlertOctagon,
  ShieldAlert,
  Play,
  Trash2,
  PlusCircle,
  FileText,
  KeyRound,
  AlertTriangle,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuditStore, findSuggestedGoldPrice } from '../store/useAuditStore';
import {
  formatNumber,
  formatWeight,
  getTodayIso,
  parseAmountInput,
  parseWeightInput,
} from '../utils/numerals';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';
import { UniversalImportPanel } from './UniversalImportPanel';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  typeof window !== 'undefined'
    ? new URL(pdfWorkerUrl, window.location.href).toString()
    : pdfWorkerUrl;

interface ExtractedRow {
  id: string;
  approved: boolean;
  type: 'buy' | 'sell';
  item: string;
  weightG: number;
  total: number;
  confidence: number;
  altWeightG?: number;
  altTotal?: number;
  hasPassDiscrepancy?: boolean;
  singlePassOnly?: boolean;
}

interface TotalsRowInfo {
  weight_g: number | null;
  total: number | null;
}

export const PhotoUploadScreen: React.FC<{ onAddedSuccess: () => void }> = ({
  onAddedSuccess,
}) => {
  const { currentDate, operations, daysMap, settings, addOperationsBatch, saveDayLedgerImage } =
    useAuditStore();

  // G3: Mode switcher between Universal Import (Excel/CSV/Word/PDF/JSON/ZIP/Paste) & Ledger Photo OCR
  const [importMode, setImportMode] = useState<'universal' | 'photo_ocr'>('universal');

  // Session-only memory for uploaded image / PDF pages
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([]);
  const [selectedPdfPageIdx, setSelectedPdfPageIdx] = useState<number>(0);
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);

  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [cropMode, setCropMode] = useState<'both_split' | 'right_sell' | 'left_buy' | 'full'>(
    'both_split'
  );
  // Fix C.2: Horizontal slicing disabled by default
  const [sliceHorizontally, setSliceHorizontally] = useState<boolean>(false);
  const [readTwiceAndCompare, setReadTwiceAndCompare] = useState<boolean>(false);
  // Prompt 6.6: Optional toggle to attach original image to the day
  const [attachImageToDay, setAttachImageToDay] = useState<boolean>(true);

  // Privacy confirmation modal state
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [dontAskAgainSession, setDontAskAgainSession] = useState<boolean>(
    () => sessionStorage.getItem('gemini_ocr_consent') === '1'
  );

  // Passcode modal state (Fix C.12)
  const [showPasscodeModal, setShowPasscodeModal] = useState<boolean>(false);
  const [passcodeInput, setPasscodeInput] = useState<string>(
    () => sessionStorage.getItem('app_passcode') || ''
  );

  // Duplicate date confirmation modal (Fix C.6)
  const [showExistingOpsConfirm, setShowExistingOpsConfirm] = useState<boolean>(false);

  // Reading progress & timer
  const [isReading, setIsReading] = useState<boolean>(false);
  const [progressStep, setProgressStep] = useState<string>('');
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Extracted state
  const [pageDate, setPageDate] = useState<string>(currentDate || getTodayIso());
  const [pageGoldPrice, setPageGoldPrice] = useState<number>(() =>
    findSuggestedGoldPrice(currentDate || getTodayIso(), daysMap)
  );
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[]>([]);
  // Fix C.4: Store totals_row per side (sell vs buy) independently
  const [totalsBySide, setTotalsBySide] = useState<{
    sell: TotalsRowInfo | null;
    buy: TotalsRowInfo | null;
  }>({ sell: null, buy: null });
  const [redMarks, setRedMarks] = useState<string[]>([]);
  const [imageZoom, setImageZoom] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const renderPdfToImages = async (file: File) => {
    setPdfLoading(true);
    setErrorMsg(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages: string[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          pages.push(canvas.toDataURL('image/jpeg', 0.88));
        }
      }
      if (pages.length > 0) {
        setPdfPageImages(pages);
        setSelectedPdfPageIdx(0);
        setImageSrc(pages[0]);
        setRotationDeg(0);
        setExtractedRows([]);
        setTotalsBySide({ sell: null, buy: null });
        setRedMarks([]);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر قراءة ملف PDF. تأكد من أن الملف سليم.');
    } finally {
      setPdfLoading(false);
    }
  };

  const loadFileForOcr = (file: File) => {
    setImportMode('photo_ocr');
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      renderPdfToImages(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPdfPageImages([]);
      setSelectedPdfPageIdx(0);
      setImageSrc(reader.result as string);
      setRotationDeg(0);
      setExtractedRows([]);
      setTotalsBySide({ sell: null, buy: null });
      setRedMarks([]);
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadFileForOcr(file);
  };

  /**
   * Renders rotated/cropped/sliced canvas with max width 2000px and JPEG quality 0.85
   * Fix C.2: Uses 12% vertical overlap (top: 0..56%, bottom: 44%..100%)
   */
  const buildProcessedBase64 = (
    sourceUrl: string,
    rot: number,
    horizontalRegion: 'full' | 'right_half' | 'left_half',
    verticalRegion: 'full' | 'top_half' | 'bottom_half'
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
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

        let sx = 0;
        let sw = rotW;
        if (horizontalRegion === 'right_half') {
          sx = Math.floor(rotW * 0.48);
          sw = rotW - sx;
        } else if (horizontalRegion === 'left_half') {
          sx = 0;
          sw = Math.floor(rotW * 0.52);
        }

        // Fix C.2: 12% vertical overlap between top_half (0%..56%) and bottom_half (44%..100%)
        let sy = 0;
        let sh = rotH;
        if (verticalRegion === 'top_half') {
          sy = 0;
          sh = Math.floor(rotH * 0.56);
        } else if (verticalRegion === 'bottom_half') {
          sy = Math.floor(rotH * 0.44);
          sh = rotH - sy;
        }

        const scale = sw > 2000 ? 2000 / sw : 1;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = Math.max(1, Math.round(sw * scale));
        outCanvas.height = Math.max(1, Math.round(sh * scale));
        const oCtx = outCanvas.getContext('2d');
        if (!oCtx) return reject(new Error('Output canvas context unavailable'));

        oCtx.drawImage(
          rotCanvas,
          sx,
          sy,
          sw,
          sh,
          0,
          0,
          outCanvas.width,
          outCanvas.height
        );

        const dataUrl = outCanvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1] || '';
        resolve(base64);
      };
      img.onerror = () => reject(new Error('تعذر تحميل الصورة في المتصفح'));
      img.src = sourceUrl;
    });
  };

  // Call main process / backend via goldApi.ocr.readLedger with automatic retry
  const callOcrWithRetry = async (payload: {
    imageBase64: string;
    forcedSideType?: 'buy' | 'sell';
    slicePosition?: 'top' | 'bottom';
  }) => {
    if (settings.disablePhotoUpload) {
      throw new Error('ميزة قراءة الصور معطّلة من الإعدادات.');
    }
    const api = ensureGoldApiBridge();
    const storedPasscode = sessionStorage.getItem('app_passcode') || '';
    const res = await api.ocr.readLedger({
      imageBase64: payload.imageBase64,
      mimeType: 'image/jpeg',
      forcedSideType: payload.forcedSideType || 'auto',
      slicePosition: payload.slicePosition || 'full',
      modelName: settings.geminiModel || 'gemini-3.8-flash',
      passcode: storedPasscode,
    });
    if (res.requirePasscode) {
      setShowPasscodeModal(true);
      throw new Error('PASSCODE_REQUIRED');
    }
    if (!res.ok) {
      throw new Error(res.error || 'فشل طلب قراءة الصفحة');
    }
    return res.data;
  };

  const requestStartReading = () => {
    if (!imageSrc || settings.disablePhotoUpload) return;
    if (sessionStorage.getItem('gemini_ocr_consent') === '1' || dontAskAgainSession) {
      executeOcrPipeline();
    } else {
      setShowConsentModal(true);
    }
  };

  const executeOcrPipeline = async () => {
    if (!imageSrc) return;
    if (dontAskAgainSession) {
      sessionStorage.setItem('gemini_ocr_consent', '1');
    }
    setShowConsentModal(false);
    setIsReading(true);
    setErrorMsg(null);
    setElapsedSec(0);

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTime) / 1000));
    }, 500);

    try {
      interface OcrJob {
        label: string;
        hRegion: 'full' | 'right_half' | 'left_half';
        vRegion: 'full' | 'top_half' | 'bottom_half';
        forcedSide?: 'buy' | 'sell';
      }

      const jobs: OcrJob[] = [];
      const addSideJobs = (
        hRegion: 'full' | 'right_half' | 'left_half',
        forcedSide: 'buy' | 'sell' | undefined,
        sideTitle: string
      ) => {
        if (sliceHorizontally) {
          jobs.push({
            label: `${sideTitle} (الشريحة العلوية)`,
            hRegion,
            vRegion: 'top_half',
            forcedSide,
          });
          jobs.push({
            label: `${sideTitle} (الشريحة السفلية)`,
            hRegion,
            vRegion: 'bottom_half',
            forcedSide,
          });
        } else {
          jobs.push({
            label: sideTitle,
            hRegion,
            vRegion: 'full',
            forcedSide,
          });
        }
      };

      if (cropMode === 'both_split') {
        addSideJobs('right_half', 'sell', 'نصف المبيعات الأيمن');
        addSideJobs('left_half', 'buy', 'نصف المشتريات الأيسر');
      } else if (cropMode === 'right_sell') {
        addSideJobs('right_half', 'sell', 'نصف المبيعات الأيمن');
      } else if (cropMode === 'left_buy') {
        addSideJobs('left_half', 'buy', 'نصف المشتريات الأيسر');
      } else {
        addSideJobs('full', undefined, 'الصفحة كاملة');
      }

      const runPass = async (passLabel: string) => {
        const rawReadRows: ExtractedRow[] = [];
        let detectedDate: string | null = null;
        let detectedGoldPrice: number | null = null;
        let detectedSellTotals: TotalsRowInfo | null = null;
        let detectedBuyTotals: TotalsRowInfo | null = null;
        const collectedRedMarks: string[] = [];

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          setProgressStep(
            `${passLabel} (${i + 1}/${jobs.length}): جاري قراءة ${job.label}...`
          );
          const base64 = await buildProcessedBase64(
            imageSrc,
            rotationDeg,
            job.hRegion,
            job.vRegion
          );
          const result = await callOcrWithRetry({
            imageBase64: base64,
            forcedSideType: job.forcedSide,
            slicePosition:
              job.vRegion === 'top_half'
                ? 'top'
                : job.vRegion === 'bottom_half'
                ? 'bottom'
                : undefined,
          });

          if (result.date && !detectedDate) detectedDate = result.date;
          if (result.day_gold_price && !detectedGoldPrice) {
            detectedGoldPrice = Number(result.day_gold_price);
          }

          // Fix C.4: Store totals_row separately per side (buy vs sell)
          if (result.totals_row && (result.totals_row.weight_g || result.totals_row.total)) {
            if (job.forcedSide === 'buy') {
              detectedBuyTotals = result.totals_row;
            } else {
              detectedSellTotals = result.totals_row;
            }
          }

          if (Array.isArray(result.red_marks)) {
            collectedRedMarks.push(...result.red_marks);
          }

          if (Array.isArray(result.rows)) {
            for (const r of result.rows) {
              const g = Number(r.weight_g) || 0;
              const ml = Number(r.weight_ml) || 0;
              const fullWeight = Number(
                (g + (ml >= 1000 ? (ml % 1000) / 1000 : ml / 1000)).toFixed(3)
              );
              const total = Number(r.total) || 0;
              if (fullWeight <= 0 && total <= 0) continue;

              const rowType: 'buy' | 'sell' =
                job.forcedSide || (r.type === 'buy' ? 'buy' : 'sell');

              rawReadRows.push({
                id: `ocr-${Date.now()}-${rawReadRows.length}-${Math.random()
                  .toString(36)
                  .slice(2, 5)}`,
                approved: true,
                type: rowType,
                item: r.item || '',
                weightG: fullWeight,
                total,
                confidence: typeof r.confidence === 'number' ? r.confidence : 0.8,
              });
            }
          }
        }

        // Fix C.2: Deduplicate across ALL read rows when slicing horizontally by (type + weightG + total)
        const mergedRows: ExtractedRow[] = [];
        for (const candidate of rawReadRows) {
          if (sliceHorizontally) {
            const isDup = mergedRows.some(
              (existing) =>
                existing.type === candidate.type &&
                Math.abs(existing.weightG - candidate.weightG) < 0.005 &&
                Math.abs(existing.total - candidate.total) < 5
            );
            if (isDup) continue;
          }
          mergedRows.push(candidate);
        }

        return {
          rows: mergedRows,
          detectedDate,
          detectedGoldPrice,
          detectedSellTotals,
          detectedBuyTotals,
          collectedRedMarks,
        };
      };

      const pass1 = await runPass('القراءة الأولى');
      let finalRows = pass1.rows;

      // Fix C.3: Dual-pass comparison by nearest (type + weight + total) matching instead of index
      if (readTwiceAndCompare) {
        const pass2 = await runPass('القراءة الثانية للمقارنة');
        const usedPass2Indices = new Set<number>();
        const matchedResult: ExtractedRow[] = [];

        for (const r1 of pass1.rows) {
          let bestIdx = -1;
          let bestScore = Infinity;

          for (let j = 0; j < pass2.rows.length; j++) {
            if (usedPass2Indices.has(j)) continue;
            const r2 = pass2.rows[j];
            if (r2.type !== r1.type) continue;

            const relWeightDiff =
              Math.abs(r1.weightG - r2.weightG) / Math.max(1, r1.weightG);
            const relTotalDiff =
              Math.abs(r1.total - r2.total) / Math.max(100, r1.total);
            const score = relWeightDiff + relTotalDiff;

            // Consider a match if combined relative distance < 0.35
            if (score < bestScore && score < 0.35) {
              bestScore = score;
              bestIdx = j;
            }
          }

          if (bestIdx !== -1) {
            usedPass2Indices.add(bestIdx);
            const r2 = pass2.rows[bestIdx];
            const weightDiffers = Math.abs(r1.weightG - r2.weightG) > 0.005;
            const totalDiffers = Math.abs(r1.total - r2.total) > 2;
            if (weightDiffers || totalDiffers) {
              matchedResult.push({
                ...r1,
                altWeightG: r2.weightG,
                altTotal: r2.total,
                hasPassDiscrepancy: true,
              });
            } else {
              matchedResult.push(r1);
            }
          } else {
            // Unmatched in Pass 2
            matchedResult.push({
              ...r1,
              hasPassDiscrepancy: true,
              singlePassOnly: true,
            });
          }
        }

        // Also include any rows from Pass 2 that were completely missed in Pass 1
        for (let j = 0; j < pass2.rows.length; j++) {
          if (!usedPass2Indices.has(j)) {
            matchedResult.push({
              ...pass2.rows[j],
              hasPassDiscrepancy: true,
              singlePassOnly: true,
            });
          }
        }

        finalRows = matchedResult;
      }

      if (pass1.detectedDate && /^\d{4}-\d{2}-\d{2}$/.test(pass1.detectedDate)) {
        setPageDate(pass1.detectedDate);
      }
      if (pass1.detectedGoldPrice && pass1.detectedGoldPrice > 100) {
        setPageGoldPrice(pass1.detectedGoldPrice);
      }
      setTotalsBySide({
        sell: pass1.detectedSellTotals,
        buy: pass1.detectedBuyTotals,
      });
      setRedMarks(Array.from(new Set(pass1.collectedRedMarks)));
      setExtractedRows(finalRows);
    } catch (err: any) {
      if (err?.message !== 'PASSCODE_REQUIRED') {
        setErrorMsg(
          err?.message ||
            'تعذر قراءة الصورة بعد محاولتين. يرجى التأكد من وضوح الصورة والمحاولة مجدداً.'
        );
      }
    } finally {
      clearInterval(timerInterval);
      setIsReading(false);
      setProgressStep('');
    }
  };

  // Fix C.5: Check if pageDate is > 60 days from today or falls on a locked day
  const pageDateAnomaly = useMemo(() => {
    const isLockedDay = Boolean(daysMap[pageDate]?.locked);
    const todayMs = new Date(`${getTodayIso()}T00:00:00Z`).getTime();
    const pageMs = new Date(`${pageDate}T00:00:00Z`).getTime();
    const diffDays = Number.isFinite(pageMs)
      ? Math.round(Math.abs(todayMs - pageMs) / 86400000)
      : 0;
    const isFarDate = diffDays > 60;
    const existingOpsOnDate = operations.filter((o) => o.date === pageDate).length;

    return {
      isLockedDay,
      isFarDate,
      diffDays,
      existingOpsOnDate,
    };
  }, [pageDate, daysMap, operations]);

  // Fix C.4: Per-side comparison of extracted rows vs totals_row (sell vs buy independently)
  const sideComparisons = useMemo(() => {
    const approvedSell = extractedRows.filter((r) => r.approved && r.type === 'sell');
    const approvedBuy = extractedRows.filter((r) => r.approved && r.type === 'buy');

    const sellWeight = approvedSell.reduce((s, r) => s + r.weightG, 0);
    const sellTotal = approvedSell.reduce((s, r) => s + r.total, 0);
    const buyWeight = approvedBuy.reduce((s, r) => s + r.weightG, 0);
    const buyTotal = approvedBuy.reduce((s, r) => s + r.total, 0);

    const sellWeightMismatch = Boolean(
      totalsBySide.sell?.weight_g && Math.abs(sellWeight - totalsBySide.sell.weight_g) > 0.2
    );
    const sellTotalMismatch = Boolean(
      totalsBySide.sell?.total && Math.abs(sellTotal - totalsBySide.sell.total) > 50
    );

    const buyWeightMismatch = Boolean(
      totalsBySide.buy?.weight_g && Math.abs(buyWeight - totalsBySide.buy.weight_g) > 0.2
    );
    const buyTotalMismatch = Boolean(
      totalsBySide.buy?.total && Math.abs(buyTotal - totalsBySide.buy.total) > 50
    );

    return {
      sell: {
        sumWeight: sellWeight,
        sumTotal: sellTotal,
        totalsRow: totalsBySide.sell,
        hasMismatch: sellWeightMismatch || sellTotalMismatch,
      },
      buy: {
        sumWeight: buyWeight,
        sumTotal: buyTotal,
        totalsRow: totalsBySide.buy,
        hasMismatch: buyWeightMismatch || buyTotalMismatch,
      },
    };
  }, [extractedRows, totalsBySide]);

  const executeAddApprovedToLedger = async () => {
    const approved = extractedRows.filter((r) => r.approved && r.weightG > 0 && r.total > 0);
    if (approved.length === 0) return;

    const res = addOperationsBatch(
      approved.map((r) => ({
        date: pageDate,
        kind: r.type,
        karat: 21,
        weightG: r.weightG,
        total: r.total,
        item: r.item,
        payment: 'cash',
      })),
      pageGoldPrice,
      'صورة دفتر'
    );

    if (!res.ok) {
      setErrorMsg(res.error || 'تعذر إضافة الصفوف');
      setShowExistingOpsConfirm(false);
      return;
    }

    // Prompt 6.6: Optionally attach the compressed ledger image to the day via goldApi.storage.saveImage
    if (attachImageToDay && imageSrc) {
      try {
        const compressedBase64 = await buildProcessedBase64(imageSrc, rotationDeg, 'full', 'full');
        await saveDayLedgerImage(pageDate, `data:image/jpeg;base64,${compressedBase64}`);
      } catch {
        // ignore image attach error
      }
    }

    setShowExistingOpsConfirm(false);
    setImageSrc(null);
    setPdfPageImages([]);
    setExtractedRows([]);
    onAddedSuccess();
  };

  const handleAddApprovedClick = () => {
    const approved = extractedRows.filter((r) => r.approved && r.weightG > 0 && r.total > 0);
    if (approved.length === 0) return;

    if (pageDateAnomaly.isLockedDay) {
      setErrorMsg(
        `لا يمكن الإضافة لأن يوم ${pageDate} مقفول بعد المراجعة. يرجى تغيير التاريخ أو فتح القفل أولاً.`
      );
      return;
    }

    // Fix C.6: Warn if target date already has operations
    if (pageDateAnomaly.existingOpsOnDate > 0) {
      setShowExistingOpsConfirm(true);
      return;
    }

    executeAddApprovedToLedger();
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Mode Switcher: Universal Import (G3) vs Photo/Scanned PDF OCR */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-wrap items-center gap-2 shadow-xs">
        <button
          type="button"
          onClick={() => setImportMode('universal')}
          className={`flex-1 min-w-[240px] py-2.5 px-4 rounded-lg text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer ${
            importMode === 'universal'
              ? 'bg-slate-900 text-amber-400 shadow-xs'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>الاستيراد الشامل (Excel / CSV / Word / PDF نصي / HTML / JSON / ZIP / لصق)</span>
        </button>

        <button
          type="button"
          onClick={() => setImportMode('photo_ocr')}
          className={`flex-1 min-w-[240px] py-2.5 px-4 rounded-lg text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer ${
            importMode === 'photo_ocr'
              ? 'bg-slate-900 text-amber-400 shadow-xs'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>قراءة صورة الدفتر المكتوب بخط اليد أو PDF ممسوح (CamScanner)</span>
        </button>
      </div>

      {importMode === 'universal' ? (
        <UniversalImportPanel
          onAddedSuccess={onAddedSuccess}
          onForwardFileToPhotoOcr={(file) => loadFileForOcr(file)}
        />
      ) : (
        <>
          {/* Upload & Pre-processing Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
              رفع صورة أو ملف PDF لصفحة الدفتر وقراءتها آلياً
            </h2>
            <p className="text-xs text-slate-500">
              يقبل صور (JPG/PNG) أو ملفات PDF متعددة الصفحات (CamScanner) ويراجعها قبل الإضافة.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2 transition-colors"
            >
              <Camera className="w-4 h-4" />
              <span>ارفع صورة أو ملف PDF للدفتر</span>
            </button>
          </div>
        </div>

        {/* Fix C.1: PDF Page Selector */}
        {pdfLoading && (
          <div className="p-3 bg-slate-100 rounded-lg text-xs font-bold text-slate-700">
            جاري تحويل صفحات ملف الـ PDF إلى صور داخل المتصفح...
          </div>
        )}

        {pdfPageImages.length > 1 && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <FileText className="w-4 h-4 text-amber-600" />
              <span>
                ملف PDF يحتوي على {pdfPageImages.length} صفحات — اختر الصفحة لقراءتها:
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {pdfPageImages.map((imgUrl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setSelectedPdfPageIdx(idx);
                    setImageSrc(imgUrl);
                    setExtractedRows([]);
                    setTotalsBySide({ sell: null, buy: null });
                  }}
                  className={`px-3 py-1 rounded-lg font-mono font-bold transition-colors ${
                    selectedPdfPageIdx === idx
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  صفحة {idx + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {imageSrc && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            {/* Crop & Rotate Controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setRotationDeg((d) => (d + 90) % 360)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg inline-flex items-center gap-1.5"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>تدوير ({rotationDeg}°)</span>
              </button>

              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                <Scissors className="w-3.5 h-3.5 text-slate-500 mx-1" />
                {(
                  [
                    { id: 'both_split', label: 'النصفين (كل نصف بطلب مستقل)' },
                    { id: 'right_sell', label: 'نصف المبيعات فقط (الأيمن)' },
                    { id: 'left_buy', label: 'نصف المشتريات فقط (الأيسر)' },
                    { id: 'full', label: 'الصفحة كصورة واحدة' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setCropMode(m.id)}
                    className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                      cropMode === m.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accuracy Options */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={sliceHorizontally}
                  onChange={(e) => setSliceHorizontally(e.target.checked)}
                  className="rounded text-amber-600"
                />
                <span>تقسيم لشريحتين أفقيتين بتداخل 12% (للصفحات المزدحمة)</span>
              </label>

              <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={readTwiceAndCompare}
                  onChange={(e) => setReadTwiceAndCompare(e.target.checked)}
                  className="rounded text-amber-600"
                />
                <span>قراءة مرتين ومقارنة الفروق بالمطابقة</span>
              </label>

              <button
                type="button"
                disabled={isReading}
                onClick={requestStartReading}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{isReading ? `جاري القراءة (${elapsedSec} ث)...` : 'ابدأ قراءة الأرقام'}</span>
              </button>
            </div>
          </div>
        )}

        {isReading && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900 font-bold">
            <span>{progressStep || 'جاري معالجة الصورة وإرسالها...'}</span>
            <span className="font-mono">الزمن المنقضي: {elapsedSec} ثانية</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 font-bold flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Side-by-Side Image Viewer & Editable Review Table */}
      {imageSrc && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Original Zoomable Image Panel */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800">
                الصورة الأصلية للمطابقة البصرية
                {pdfPageImages.length > 1 ? ` (صفحة ${selectedPdfPageIdx + 1})` : ''}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}
                  className="p-1 bg-white border border-slate-200 rounded hover:bg-slate-100"
                  title="تصغير"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono px-1">{Math.round(imageZoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}
                  className="p-1 bg-white border border-slate-200 rounded hover:bg-slate-100"
                  title="تكبير"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-3 bg-slate-900 overflow-auto max-h-[640px] flex items-center justify-center">
              <img
                src={imageSrc}
                alt="صفحة دفتر اليومية"
                referrerPolicy="no-referrer"
                style={{
                  transform: `scale(${imageZoom}) rotate(${rotationDeg}deg)`,
                  transformOrigin: 'top center',
                }}
                className="max-w-full h-auto transition-transform duration-150 rounded"
              />
            </div>
          </div>

          {/* Editable Review Table Panel */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                    تاريخ الصفحة المقروء
                  </label>
                  <input
                    type="date"
                    value={pageDate}
                    onChange={(e) => setPageDate(e.target.value)}
                    className={`px-2.5 py-1 text-xs font-mono font-bold border-2 rounded ${
                      pageDateAnomaly.isLockedDay || pageDateAnomaly.isFarDate
                        ? 'border-red-600 bg-red-50 text-red-900'
                        : 'border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                    سعر الذهب اليومي المقروء (عيار 21)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pageGoldPrice || ''}
                    placeholder="سعر عيار 21..."
                    onChange={(e) => setPageGoldPrice(parseAmountInput(e.target.value))}
                    className={`w-32 px-2.5 py-1 text-xs font-mono font-bold border-2 rounded ${
                      !pageGoldPrice || pageGoldPrice <= 0
                        ? 'border-red-500 bg-red-50'
                        : 'border-slate-300'
                    }`}
                  />
                </div>
              </div>

              {extractedRows.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={attachImageToDay}
                      onChange={(e) => setAttachImageToDay(e.target.checked)}
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>أرفق الصورة باليوم</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddApprovedClick}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      أضف الكل لليومية ({extractedRows.filter((r) => r.approved).length} صف معتمد)
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* Fix C.5: Red alert if pageDate is locked or > 60 days from today */}
            {(pageDateAnomaly.isLockedDay || pageDateAnomaly.isFarDate) && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-lg text-xs text-red-900 font-bold flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
                <span>
                  {pageDateAnomaly.isLockedDay
                    ? `تنبيه: تاريخ الصفحة (${pageDate}) يقع في يوم مقفول بعد المراجعة! لا يمكن الإضافة قبل فتح القفل أو تصحيح التاريخ.`
                    : `تنبيه: تاريخ الصفحة المقروء (${pageDate}) يبتعد عن تاريخ اليوم بأكثر من 60 يوماً (${pageDateAnomaly.diffDays} يوماً). تحقق من السنة والشهر قبل الإضافة!`}
                </span>
              </div>
            )}

            {/* Fix C.4: Independent Totals Row Comparison per Side (Sell vs Buy) */}
            {(sideComparisons.sell.totalsRow || sideComparisons.buy.totalsRow) && (
              <div className="space-y-2">
                {sideComparisons.sell.totalsRow && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                      sideComparisons.sell.hasMismatch
                        ? 'bg-red-50 border-red-300 text-red-900'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    }`}
                  >
                    <span className="font-bold">مطابقة إجمالي المبيعات (الجانب الأيمن):</span>
                    <span className="font-mono">
                      الوزن: {formatWeight(sideComparisons.sell.sumWeight)} ج (الدفتر:{' '}
                      {sideComparisons.sell.totalsRow.weight_g ?? '—'}) · المبلغ:{' '}
                      {formatNumber(sideComparisons.sell.sumTotal)} ج.م (الدفتر:{' '}
                      {sideComparisons.sell.totalsRow.total
                        ? formatNumber(sideComparisons.sell.totalsRow.total)
                        : '—'}
                      )
                    </span>
                  </div>
                )}

                {sideComparisons.buy.totalsRow && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                      sideComparisons.buy.hasMismatch
                        ? 'bg-red-50 border-red-300 text-red-900'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    }`}
                  >
                    <span className="font-bold">مطابقة إجمالي المشتريات (الجانب الأيسر):</span>
                    <span className="font-mono">
                      الوزن: {formatWeight(sideComparisons.buy.sumWeight)} ج (الدفتر:{' '}
                      {sideComparisons.buy.totalsRow.weight_g ?? '—'}) · المبلغ:{' '}
                      {formatNumber(sideComparisons.buy.sumTotal)} ج.م (الدفتر:{' '}
                      {sideComparisons.buy.totalsRow.total
                        ? formatNumber(sideComparisons.buy.totalsRow.total)
                        : '—'}
                      )
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Red Marks Note */}
            {redMarks.length > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                <span className="font-bold">علامات الحبر الأحمر التي تم تجاهلها كعمليات: </span>
                <span>{redMarks.join(' ، ')}</span>
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-yellow-200 border border-yellow-500 inline-block" />
                خلية صفراء = ثقة قراءة أقل من 70%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-200 border border-red-500 inline-block" />
                خلية حمراء = اختلاف منطقي أو فرق بين القراءتين أو صف موجود في قراءة واحدة فقط
              </span>
            </div>

            {/* Editable Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                    <th className="py-2 px-2 w-10 text-center">اعتماد</th>
                    <th className="py-2 px-2 w-20">النوع</th>
                    <th className="py-2 px-2">البيان</th>
                    <th className="py-2 px-2 w-28">الوزن (جرام)</th>
                    <th className="py-2 px-2 w-32">الإجمالي</th>
                    <th className="py-2 px-2 w-24">سعر الجرام</th>
                    <th className="py-2 px-2 w-20 text-center">الحالة</th>
                    <th className="py-2 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {extractedRows.map((r, idx) => {
                    const lowConf = r.confidence < 0.7;
                    const gramPrice = r.weightG > 0 ? r.total / r.weightG : 0;
                    const logicalMismatch =
                      pageGoldPrice > 0 &&
                      gramPrice > 0 &&
                      Math.abs(gramPrice - pageGoldPrice) / pageGoldPrice > 0.12;

                    const cellBg =
                      r.hasPassDiscrepancy || logicalMismatch
                        ? 'bg-red-100 border-red-500'
                        : lowConf
                        ? 'bg-yellow-100 border-yellow-500'
                        : 'bg-white border-slate-200';

                    return (
                      <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="py-1.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={r.approved}
                            onChange={(e) => {
                              const next = [...extractedRows];
                              next[idx] = { ...r, approved: e.target.checked };
                              setExtractedRows(next);
                            }}
                            className="rounded text-emerald-600"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <select
                            value={r.type}
                            onChange={(e) => {
                              const next = [...extractedRows];
                              next[idx] = { ...r, type: e.target.value as 'buy' | 'sell' };
                              setExtractedRows(next);
                            }}
                            className="px-1.5 py-1 border border-slate-200 rounded bg-white font-bold"
                          >
                            <option value="sell">بيع</option>
                            <option value="buy">شراء</option>
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={r.item}
                            onChange={(e) => {
                              const next = [...extractedRows];
                              next[idx] = { ...r, item: e.target.value };
                              setExtractedRows(next);
                            }}
                            className="w-full px-2 py-1 border border-slate-200 rounded bg-white"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.weightG}
                            onChange={(e) => {
                              const next = [...extractedRows];
                              next[idx] = {
                                ...r,
                                weightG: parseWeightInput(
                                  e.target.value,
                                  settings.shortSpaceWeightMode
                                ),
                              };
                              setExtractedRows(next);
                            }}
                            className={`w-full px-2 py-1 font-mono font-bold border rounded ${cellBg}`}
                          />
                          {r.altWeightG !== undefined && r.altWeightG !== r.weightG && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = [...extractedRows];
                                next[idx] = {
                                  ...r,
                                  weightG: r.altWeightG!,
                                  hasPassDiscrepancy: false,
                                };
                                setExtractedRows(next);
                              }}
                              className="mt-0.5 text-[10px] text-red-700 underline block"
                            >
                              القراءة 2: {formatWeight(r.altWeightG)}
                            </button>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.total}
                            onChange={(e) => {
                              const next = [...extractedRows];
                              next[idx] = {
                                ...r,
                                total: parseAmountInput(e.target.value),
                              };
                              setExtractedRows(next);
                            }}
                            className={`w-full px-2 py-1 font-mono font-bold border rounded ${cellBg}`}
                          />
                          {r.altTotal !== undefined && r.altTotal !== r.total && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = [...extractedRows];
                                next[idx] = {
                                  ...r,
                                  total: r.altTotal!,
                                  hasPassDiscrepancy: false,
                                };
                                setExtractedRows(next);
                              }}
                              className="mt-0.5 text-[10px] text-red-700 underline block"
                            >
                              القراءة 2: {formatNumber(r.altTotal)}
                            </button>
                          )}
                        </td>
                        <td className="py-1.5 px-2 font-mono">
                          {gramPrice > 0 ? formatNumber(gramPrice, 0) : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono">
                          {r.singlePassOnly ? (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold block">
                              موجود في قراءة واحدة فقط
                            </span>
                          ) : (
                            <span>{Math.round(r.confidence * 100)}%</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setExtractedRows(extractedRows.filter((_, i) => i !== idx))
                            }
                            className="text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() =>
                setExtractedRows([
                  ...extractedRows,
                  {
                    id: `manual-${Date.now()}`,
                    approved: true,
                    type: 'sell',
                    item: '',
                    weightG: 0,
                    total: 0,
                    confidence: 1,
                  },
                ])
              }
              className="text-xs font-bold text-amber-700 hover:underline inline-flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>إضافة صف يدوي للجدول</span>
            </button>
          </div>
        </div>
      )}

      {/* Fix C.6: Warning Confirmation Modal if target date already has existing operations */}
      {showExistingOpsConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-base">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>تنبيه: توجد عمليات سابقة في هذا التاريخ</span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              يوجد بالفعل <strong>{pageDateAnomaly.existingOpsOnDate} عملية</strong> مسجلة بتاريخ{' '}
              <span className="font-mono font-bold">{pageDate}</span>. هناك احتمال أن تكون هذه الصفحة قد رُفعت من قبل. هل تريد المتابعة وإضافة الصفوف المعتمدة؟
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowExistingOpsConfirm(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء ومراجعة التاريخ
              </button>
              <button
                type="button"
                onClick={executeAddApprovedToLedger}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
              >
                نعم، أضف الصفوف لليومية
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix C.12: Server APP_PASSCODE Prompt Modal */}
      {showPasscodeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
              <KeyRound className="w-5 h-5 text-amber-600 shrink-0" />
              <span>كلمة مرور الخادم مطلوبة</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              الخادم محمي بكلمة مرور (<code className="font-mono">APP_PASSCODE</code>) لحماية رصيد Gemini API. أدخل كلمة المرور مرة واحدة لهذه الجلسة:
            </p>
            <input
              type="password"
              autoFocus
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && passcodeInput.trim()) {
                  sessionStorage.setItem('app_passcode', passcodeInput.trim());
                  setShowPasscodeModal(false);
                  executeOcrPipeline();
                }
              }}
              placeholder="أدخل كلمة المرور..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:border-amber-600"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasscodeModal(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem('app_passcode', passcodeInput.trim());
                  setShowPasscodeModal(false);
                  executeOcrPipeline();
                }}
                className="px-4 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg"
              >
                حفظ ومتابعة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Privacy Confirmation Dialog BEFORE Sending Image to Gemini */}
      {showConsentModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-base">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
              <span>تأكيد إرسال الصورة لقراءة الأرقام</span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              هذه الصورة سترسل إلى خدمة <strong>Gemini من Google</strong> لقراءة الأرقام المكتوبة بخط اليد وتحويلها إلى جدول. لا يتم حفظ الصورة بعد انتهاء الجلسة.
            </p>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontAskAgainSession}
                onChange={(e) => setDontAskAgainSession(e.target.checked)}
                className="rounded text-amber-600"
              />
              <span>لا تسألني مرة ثانية في هذه الجلسة</span>
            </label>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConsentModal(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={executeOcrPipeline}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg"
              >
                موافق، أرسل الصورة للقراءة
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
