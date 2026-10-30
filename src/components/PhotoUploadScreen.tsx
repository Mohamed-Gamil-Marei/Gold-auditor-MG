import React, { useState, useRef, useMemo, useEffect } from 'react';
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
  Layers,
  Map as MapIcon,
  Sparkles,
  BookOpen,
  Pause,
  RotateCcw,
  Search,
  Split,
  Merge,
  Check,
  Download,
  Sliders,
  HelpCircle,
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
import { randomSuffix } from '../utils/ids';
import {
  LedgerPageKind,
  LedgerPageRegion,
  RedMarkItem,
  HandwrittenSideTotals,
  DayLedgerPageMeta,
} from '../types';
import {
  ScannedLedgerPage,
  ExtractedLedgerRow,
  DiscoveredLedgerDay,
  groupPagesIntoDays,
  updatePageClassification,
  mergeTwoDiscoveredDays,
  splitDayFromPage,
  rankSuspectRowsForDiff,
  normalizeRedMarks,
  attachRedMarksToRows,
  hasDiscrepantRedNumber,
  classifyLedgerPageKind,
} from '../import/ledgerGrouping';
import {
  computeImageHash,
  preprocessLedgerImage,
  cropWeakRowStripBase64,
  getDefaultLedgerRegions,
} from '../import/imagePreprocessor';
import {
  loadCorrectionDictionary,
  saveCorrectionDictionary,
  applyDictionaryToItemName,
  learnItemCorrection,
  learnDigitCorrection,
  suggestDigitConfusionFix,
  buildDictionaryPromptHints,
  LocalCorrectionDictionary,
} from '../import/correctionDictionary';
import {
  estimateOcrJobCostAndTime,
  getCachedPageOcrResult,
  setCachedPageOcrResult,
  saveLedgerJobState,
  loadLedgerJobState,
  clearLedgerJobState,
  PersistedLedgerJobState,
} from '../import/ocrQueueManager';
import { exportToExcelFormat } from '../export/exportService';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  typeof window !== 'undefined'
    ? new URL(pdfWorkerUrl, window.location.href).toString()
    : pdfWorkerUrl;

export const PhotoUploadScreen: React.FC<{ onAddedSuccess: () => void }> = ({
  onAddedSuccess,
}) => {
  const {
    currentDate,
    daysMap,
    settings,
    addOperationsBatch,
    saveDayLedgerImage,
    updateDayInfo,
    convertRedCirclesToReviewedFlag,
  } = useAuditStore();

  // Top mode switcher: Universal Import (G3) vs Scanned Ledger OCR (Part 4: H1-H6 + P1-P5)
  const [importMode, setImportMode] = useState<'universal' | 'photo_ocr'>('universal');

  // Part 4 Sub-navigation inside Scanned Ledger OCR
  const [ocrSubTab, setOcrSubTab] = useState<'reader' | 'days' | 'file_map'>('reader');

  // Multi-page state (H1, H6, P1)
  const [fileName, setFileName] = useState<string>('دفتر-ممسوح.pdf');
  const [scannedPages, setScannedPages] = useState<ScannedLedgerPage[]>([]);
  const [selectedPageIdx, setSelectedPageIdx] = useState<number>(0);
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);

  // Saved / Interrupted job resume banner (H6.6 & P1)
  const [resumableJob, setResumableJob] = useState<PersistedLedgerJobState | null>(null);

  useEffect(() => {
    loadLedgerJobState().then((loaded) => {
      if (loaded) setResumableJob(loaded);
    });
  }, []);

  // Pre-processing & OCR controls (H2, P2, P4)
  const [cropMode, setCropMode] = useState<'both_split' | 'right_sell' | 'left_buy' | 'full'>(
    'both_split'
  );
  const [sliceHorizontally, setSliceHorizontally] = useState<boolean>(false);
  const [readTwiceAndCompare, setReadTwiceAndCompare] = useState<boolean>(false);
  const [attachImageToDay, setAttachImageToDay] = useState<boolean>(true);
  const [enhancementPreset, setEnhancementPreset] = useState<
    'standard' | 'low_quality_boost' | 'color_preserve'
  >('standard');
  const [showRegionEditor, setShowRegionEditor] = useState<boolean>(false);
  const [customRegions, setCustomRegions] = useState<LedgerPageRegion[]>(() =>
    getDefaultLedgerRegions('both_split')
  );

  // P2 A/B comparison banner
  const [abCompareBanner, setAbCompareBanner] = useState<{
    normalConfidentCount: number;
    boostedConfidentCount: number;
    recommended: 'normal' | 'boosted';
  } | null>(null);

  // P3 Self-learning dictionary state & modal
  const [dictionary, setDictionary] = useState<LocalCorrectionDictionary>(() =>
    loadCorrectionDictionary()
  );
  const [showDictionaryModal, setShowDictionaryModal] = useState<boolean>(false);

  // H5 Red mark filter in preview table
  const [redMarkFilter, setRedMarkFilter] = useState<
    'all' | 'has_mark' | 'no_mark' | 'discrepant_red_number'
  >('all');

  // H3 Suspect rows modal ("أين الفرق؟")
  const [suspectModalInfo, setSuspectModalInfo] = useState<{
    dayDate: string;
    side: 'sell' | 'buy';
    diffAmount: number;
    diffWeightG: number;
    dayGoldPrice: number;
    rows: ExtractedLedgerRow[];
  } | null>(null);

  // H1 Discovered Days Overrides
  const [manualDayOverrides, setManualDayOverrides] = useState<
    Record<
      string,
      {
        date?: string;
        goldPricePerGram?: number;
        approvedSellTotal?: number | null;
        approvedBuyTotal?: number | null;
        approvedSellWeightG?: number | null;
        approvedBuyWeightG?: number | null;
        auditorApprovedDiff?: boolean;
      }
    >
  >({});
  const [mergeSourceDayId, setMergeSourceDayId] = useState<string | null>(null);

  // H6 File Map filter
  const [fileMapFilter, setFileMapFilter] = useState<
    'all' | 'needs_attention' | 'not_added'
  >('all');

  // P1 Queue execution state
  const [queueRunning, setQueueRunning] = useState<boolean>(false);
  const [queuePaused, setQueuePaused] = useState<boolean>(false);
  const queuePausedRef = useRef<boolean>(false);
  const queueCancelledRef = useRef<boolean>(false);
  const [queueProgress, setQueueProgress] = useState<{
    completed: number;
    total: number;
    etaSeconds: number;
    failedCount: number;
  }>({ completed: 0, total: 0, etaSeconds: 0, failedCount: 0 });
  const [showQueueEstimateModal, setShowQueueEstimateModal] = useState<boolean>(false);

  // Consent & Passcode modals
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [dontAskAgainSession, setDontAskAgainSession] = useState<boolean>(
    () => sessionStorage.getItem('gemini_ocr_consent') === '1'
  );
  const [showPasscodeModal, setShowPasscodeModal] = useState<boolean>(false);
  const [passcodeInput, setPasscodeInput] = useState<string>(
    () => sessionStorage.getItem('app_passcode') || ''
  );

  // Reading progress & timer
  const [isReading, setIsReading] = useState<boolean>(false);
  const [progressStep, setProgressStep] = useState<string>('');
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentPage: ScannedLedgerPage | undefined = scannedPages[selectedPageIdx];

  const updatePageAt = (
    idx: number,
    updater: (prev: ScannedLedgerPage) => ScannedLedgerPage
  ) => {
    setScannedPages((prev) => {
      if (!prev[idx]) return prev;
      const next = [...prev];
      next[idx] = updater(prev[idx]);
      return next;
    });
  };

  // Persist job state whenever pages or overrides change (H6.6)
  useEffect(() => {
    if (scannedPages.length > 1) {
      saveLedgerJobState({
        jobId: `job-${fileName}`,
        fileName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages: scannedPages,
        manualDayOverrides,
      });
    }
  }, [scannedPages, fileName, manualDayOverrides]);

  const makeInitialScannedPage = (
    pageIndexZeroBased: number,
    imageDataUrl: string,
    defaultDate: string
  ): ScannedLedgerPage => ({
    id: `page-${pageIndexZeroBased + 1}-${randomSuffix(4)}`,
    pageNumber: pageIndexZeroBased + 1,
    fileName,
    rawImageDataUrl: imageDataUrl,
    imageHash: computeImageHash(imageDataUrl),
    rotationDeg: 0,
    regions: getDefaultLedgerRegions(cropMode),
    kind: 'day_start',
    detectedDate: defaultDate,
    weekday: null,
    dayGoldPrice: findSuggestedGoldPrice(defaultDate, daysMap),
    openingBalance: null,
    closingBalance: null,
    side: 'both',
    pageNumberHint: null,
    avgConfidence: 0.85,
    rows: [],
    totalsBySide: { sell: null, buy: null },
    redMarks: [],
    readStatus: 'unread',
    importStatus: 'pending',
  });

  // H2.4: Render PDF at 200-250 DPI capped at 2400px max dimension
  const renderPdfToImages = async (file: File) => {
    setPdfLoading(true);
    setErrorMsg(null);
    setFileName(file.name);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const defaultDate = currentDate || getTodayIso();
      const newPages: ScannedLedgerPage[] = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1.0 });
        const maxBaseDim = Math.max(baseViewport.width, baseViewport.height, 1);
        const targetScale = Math.min(2.4, 2400 / maxBaseDim);
        const viewport = page.getViewport({ scale: Math.max(1.2, targetScale) });

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
          newPages.push(makeInitialScannedPage(pageNum - 1, dataUrl, defaultDate));
        }
      }
      if (newPages.length > 0) {
        setScannedPages(newPages);
        setSelectedPageIdx(0);
        setAbCompareBanner(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر قراءة ملف PDF. تأكد من أن الملف سليم.');
    } finally {
      setPdfLoading(false);
    }
  };

  const loadFilesForOcr = async (files: FileList | File[]) => {
    setImportMode('photo_ocr');
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    if (
      fileArr.length === 1 &&
      (fileArr[0].type === 'application/pdf' || fileArr[0].name.toLowerCase().endsWith('.pdf'))
    ) {
      await renderPdfToImages(fileArr[0]);
      return;
    }

    setFileName(fileArr.length === 1 ? fileArr[0].name : `${fileArr.length}-صور-دفتر`);
    const defaultDate = currentDate || getTodayIso();
    const loadedPages: ScannedLedgerPage[] = [];

    for (let i = 0; i < fileArr.length; i++) {
      const f = fileArr[i];
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
        reader.readAsDataURL(f);
      });
      loadedPages.push(makeInitialScannedPage(i, dataUrl, defaultDate));
    }

    setScannedPages(loadedPages);
    setSelectedPageIdx(0);
    setErrorMsg(null);
    setAbCompareBanner(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    loadFilesForOcr(e.target.files);
  };

  // Call backend OCR with automatic retry + P3 dictionary hints
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
    const dictHints =
      settings.enableSelfLearningDictionary !== false
        ? buildDictionaryPromptHints(dictionary)
        : undefined;

    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await api.ocr.readLedger({
          imageBase64: payload.imageBase64,
          mimeType: 'image/jpeg',
          forcedSideType: payload.forcedSideType || 'auto',
          slicePosition: payload.slicePosition || 'full',
          modelName: settings.geminiModel || 'gemini-3.8-flash',
          passcode: storedPasscode,
          dictionaryHints: dictHints,
        });
        if (res.requirePasscode) {
          setShowPasscodeModal(true);
          throw new Error('PASSCODE_REQUIRED');
        }
        if (!res.ok) {
          throw new Error(res.error || 'فشل طلب قراءة الصفحة');
        }
        return res.data;
      } catch (err: any) {
        if (err?.message === 'PASSCODE_REQUIRED') throw err;
        lastErr = err;
      }
    }
    throw lastErr || new Error('فشل طلب قراءة الصفحة بعد محاولتين');
  };

  // Core single-page OCR reader (supports H1-H5, P1 cache, P2 modes, P3 dictionary)
  const readSinglePageAtIndex = async (
    pageIdx: number,
    overridePreset?: 'standard' | 'low_quality_boost' | 'color_preserve'
  ): Promise<ScannedLedgerPage> => {
    const pageObj = scannedPages[pageIdx];
    if (!pageObj) throw new Error('الصفحة غير موجودة');

    const activePreset = overridePreset || enhancementPreset;
    updatePageAt(pageIdx, (p) => ({ ...p, readStatus: 'reading', errorMsg: undefined }));

    interface RegionJob {
      label: string;
      region: LedgerPageRegion;
      forcedSide?: 'buy' | 'sell';
      vSlice?: 'full' | 'top_half' | 'bottom_half';
    }

    const jobs: RegionJob[] = [];
    const activeRegions = showRegionEditor
      ? customRegions
      : getDefaultLedgerRegions(cropMode);

    for (const reg of activeRegions) {
      const forcedSide = reg.side === 'buy' || reg.side === 'sell' ? reg.side : undefined;
      if (sliceHorizontally) {
        jobs.push({
          label: `${reg.label} (علوي)`,
          region: { ...reg, y: 0, h: 0.56 },
          forcedSide,
          vSlice: 'top_half',
        });
        jobs.push({
          label: `${reg.label} (سفلي)`,
          region: { ...reg, y: 0.44, h: 0.56 },
          forcedSide,
          vSlice: 'bottom_half',
        });
      } else {
        jobs.push({
          label: reg.label,
          region: reg,
          forcedSide,
          vSlice: 'full',
        });
      }
    }

    const runSinglePass = async (passTitle: string) => {
      const rawRows: ExtractedLedgerRow[] = [];
      let firstRawOcr: any = null;
      let detectedDate: string | null = null;
      let detectedWeekday: string | null = null;
      let detectedGoldPrice: number | null = null;
      let openingBal: number | null = null;
      let closingBal: number | null = null;
      let pageNumHint: string | null = null;
      let pageConfSum = 0;
      let pageConfCount = 0;
      let sellTotals: HandwrittenSideTotals | null = null;
      let buyTotals: HandwrittenSideTotals | null = null;
      const allRedMarks: RedMarkItem[] = [];

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        setProgressStep(
          `صفحة ${pageIdx + 1} — ${passTitle} (${i + 1}/${jobs.length}): ${job.label}...`
        );

        const prep = await preprocessLedgerImage(pageObj.rawImageDataUrl, {
          rotationDeg: pageObj.rotationDeg,
          preset: activePreset,
          region: {
            x: job.region.x,
            y: job.region.y,
            w: job.region.w,
            h: job.region.h,
          },
        });

        const cacheKey = `${prep.imageHash}|${cropMode}|${sliceHorizontally}|${job.forcedSide || 'auto'}|${job.vSlice || 'full'}|${activePreset}`;
        let result = await getCachedPageOcrResult(cacheKey);
        if (!result) {
          result = await callOcrWithRetry({
            imageBase64: prep.processedBase64,
            forcedSideType: job.forcedSide,
            slicePosition:
              job.vSlice === 'top_half'
                ? 'top'
                : job.vSlice === 'bottom_half'
                ? 'bottom'
                : undefined,
          });
          await setCachedPageOcrResult(cacheKey, result);
        }

        if (i === 0) firstRawOcr = result;
        if (result.date && !detectedDate) detectedDate = result.date;
        if (result.weekday && !detectedWeekday) detectedWeekday = result.weekday;
        if (result.day_gold_price && !detectedGoldPrice) {
          detectedGoldPrice = Number(result.day_gold_price);
        }
        if (typeof result.opening_balance === 'number' && openingBal === null) {
          openingBal = result.opening_balance;
        }
        if (typeof result.closing_balance === 'number' && closingBal === null) {
          closingBal = result.closing_balance;
        }
        if (result.page_number_hint && !pageNumHint) {
          pageNumHint = String(result.page_number_hint);
        }
        if (typeof result.page_confidence === 'number') {
          pageConfSum += result.page_confidence;
          pageConfCount += 1;
        }

        // H3: Handwritten totals per side
        const parseSideTot = (
          rawTot: any,
          side: 'sell' | 'buy'
        ): HandwrittenSideTotals | null => {
          if (!rawTot) return null;
          const amt = rawTot.handwritten_total_amount ?? rawTot.total ?? null;
          const wt = rawTot.handwritten_total_weight_g ?? rawTot.weight_g ?? null;
          if (amt === null && wt === null && !Array.isArray(rawTot.candidates)) return null;
          return {
            side,
            handwritten_total_amount: typeof amt === 'number' ? amt : null,
            handwritten_total_weight_g: typeof wt === 'number' ? wt : null,
            closing_balance:
              typeof rawTot.closing_balance === 'number' ? rawTot.closing_balance : null,
            confidence: typeof rawTot.confidence === 'number' ? rawTot.confidence : 0.85,
            candidates: Array.isArray(rawTot.candidates)
              ? rawTot.candidates.map((c: any) =>
                  typeof c === 'number' ? c : Number(c?.amount) || 0
                )
              : undefined,
          };
        };

        if (result.totals) {
          const sTot = parseSideTot(result.totals.sell, 'sell');
          const bTot = parseSideTot(result.totals.buy, 'buy');
          if (sTot && job.forcedSide !== 'buy') sellTotals = sTot;
          if (bTot && job.forcedSide !== 'sell') buyTotals = bTot;
        }
        if (result.totals_row) {
          const targetSide = job.forcedSide === 'buy' ? 'buy' : 'sell';
          const fallbackTot = parseSideTot(result.totals_row, targetSide);
          if (fallbackTot) {
            if (targetSide === 'buy') buyTotals = buyTotals || fallbackTot;
            else sellTotals = sellTotals || fallbackTot;
          }
        }

        // H5: Normalize red marks
        if (Array.isArray(result.red_marks)) {
          allRedMarks.push(...normalizeRedMarks(result.red_marks));
        }

        // Rows + P3 dictionary application
        if (Array.isArray(result.rows)) {
          result.rows.forEach((r: any, rIdx: number) => {
            const g = Number(r.weight_g) || 0;
            const ml = Number(r.weight_ml) || 0;
            const fullWeight = Number(
              (g + (ml >= 1000 ? (ml % 1000) / 1000 : ml / 1000)).toFixed(3)
            );
            const total = Number(r.total) || 0;
            if (fullWeight <= 0 && total <= 0) return;

            const rowType: 'buy' | 'sell' =
              job.forcedSide || (r.type === 'buy' ? 'buy' : 'sell');
            const rawItem = String(r.item || '').trim();
            const normalizedItem =
              settings.enableSelfLearningDictionary !== false
                ? applyDictionaryToItemName(rawItem, dictionary)
                : rawItem;

            rawRows.push({
              id: `ocr-p${pageIdx}-${Date.now()}-${rawRows.length}-${randomSuffix(3)}`,
              approved: true,
              type: rowType,
              item: normalizedItem,
              weightG: fullWeight,
              total,
              confidence: typeof r.confidence === 'number' ? r.confidence : 0.82,
              runningBalanceBefore:
                typeof r.running_balance_before === 'number'
                  ? r.running_balance_before
                  : undefined,
              runningBalanceAfter:
                typeof r.running_balance_after === 'number'
                  ? r.running_balance_after
                  : undefined,
              yRatio:
                typeof r.y_ratio === 'number'
                  ? r.y_ratio
                  : Math.min(0.92, 0.16 + (rIdx + 1) * 0.045),
              pageId: pageObj.id,
              pageNumber: pageObj.pageNumber,
              rowOrderInPage: rawRows.length + 1,
            });
          });
        }
      }

      // Deduplicate rows if sliced horizontally
      const dedupedRows: ExtractedLedgerRow[] = [];
      for (const candidate of rawRows) {
        if (sliceHorizontally) {
          const isDup = dedupedRows.some(
            (ex) =>
              ex.type === candidate.type &&
              Math.abs(ex.weightG - candidate.weightG) < 0.005 &&
              Math.abs(ex.total - candidate.total) < 5
          );
          if (isDup) continue;
        }
        dedupedRows.push(candidate);
      }

      const linkedRows = attachRedMarksToRows(dedupedRows, allRedMarks);
      const inferredKind = classifyLedgerPageKind(firstRawOcr, linkedRows.length);

      return {
        inferredKind,
        detectedDate,
        detectedWeekday,
        detectedGoldPrice,
        openingBal,
        closingBal,
        pageNumHint,
        avgPageConf:
          pageConfCount > 0
            ? pageConfSum / pageConfCount
            : linkedRows.length > 0
            ? linkedRows.reduce((s, r) => s + r.confidence, 0) / linkedRows.length
            : 0.8,
        sellTotals,
        buyTotals,
        allRedMarks,
        rows: linkedRows,
      };
    };

    const pass1 = await runSinglePass('القراءة الأولى');
    let finalRows = pass1.rows;

    if (readTwiceAndCompare) {
      const pass2 = await runSinglePass('القراءة الثانية للمقارنة');
      const usedPass2 = new Set<number>();
      const matched: ExtractedLedgerRow[] = [];

      for (const r1 of pass1.rows) {
        let bestIdx = -1;
        let bestScore = Infinity;
        for (let j = 0; j < pass2.rows.length; j++) {
          if (usedPass2.has(j)) continue;
          const r2 = pass2.rows[j];
          if (r2.type !== r1.type) continue;
          const score =
            Math.abs(r1.weightG - r2.weightG) / Math.max(1, r1.weightG) +
            Math.abs(r1.total - r2.total) / Math.max(100, r1.total);
          if (score < bestScore && score < 0.35) {
            bestScore = score;
            bestIdx = j;
          }
        }
        if (bestIdx !== -1) {
          usedPass2.add(bestIdx);
          const r2 = pass2.rows[bestIdx];
          if (Math.abs(r1.weightG - r2.weightG) > 0.005 || Math.abs(r1.total - r2.total) > 2) {
            matched.push({
              ...r1,
              altWeightG: r2.weightG,
              altTotal: r2.total,
              hasPassDiscrepancy: true,
            });
          } else {
            matched.push(r1);
          }
        } else {
          matched.push({ ...r1, hasPassDiscrepancy: true, singlePassOnly: true });
        }
      }
      for (let j = 0; j < pass2.rows.length; j++) {
        if (!usedPass2.has(j)) {
          matched.push({ ...pass2.rows[j], hasPassDiscrepancy: true, singlePassOnly: true });
        }
      }
      finalRows = matched;
    }

    const updatedPage: ScannedLedgerPage = {
      ...pageObj,
      enhancementPresetUsed:
        activePreset === 'low_quality_boost' ? 'low_quality_boost' : 'standard',
      readStatus: 'done',
      errorMsg: undefined,
      kind: pass1.inferredKind,
      detectedDate:
        pass1.detectedDate && /^\d{4}-\d{2}-\d{2}$/.test(pass1.detectedDate)
          ? pass1.detectedDate
          : pageObj.detectedDate,
      weekday: pass1.detectedWeekday,
      dayGoldPrice:
        pass1.detectedGoldPrice && pass1.detectedGoldPrice > 100
          ? pass1.detectedGoldPrice
          : pageObj.dayGoldPrice,
      openingBalance: pass1.openingBal,
      closingBalance: pass1.closingBal,
      pageNumberHint: pass1.pageNumHint,
      avgConfidence: pass1.avgPageConf,
      rows: finalRows,
      totalsBySide: {
        sell: pass1.sellTotals,
        buy: pass1.buyTotals,
      },
      redMarks: pass1.allRedMarks,
    };

    updatePageAt(pageIdx, () => updatedPage);
    return updatedPage;
  };

  // Start reading current page
  const requestStartReading = () => {
    if (!currentPage || settings.disablePhotoUpload) return;
    if (sessionStorage.getItem('gemini_ocr_consent') === '1' || dontAskAgainSession) {
      executeSinglePageOcr();
    } else {
      setShowConsentModal(true);
    }
  };

  const executeSinglePageOcr = async () => {
    if (!currentPage) return;
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
      await readSinglePageAtIndex(selectedPageIdx);
    } catch (err: any) {
      if (err?.message !== 'PASSCODE_REQUIRED') {
        const msg =
          err?.message ||
          'تعذر قراءة الصورة بعد محاولتين. يرجى التأكد من وضوح الصورة والمحاولة مجدداً.';
        setErrorMsg(msg);
        updatePageAt(selectedPageIdx, (p) => ({ ...p, readStatus: 'failed', errorMsg: msg }));
      }
    } finally {
      clearInterval(timerInterval);
      setIsReading(false);
      setProgressStep('');
    }
  };

  // P1: Run Queue across all pending/failed pages (max 2 concurrent requests)
  const startMultiPageQueue = async () => {
    if (scannedPages.length === 0) return;
    setShowQueueEstimateModal(false);
    setQueueRunning(true);
    setQueuePaused(false);
    queuePausedRef.current = false;
    queueCancelledRef.current = false;
    setErrorMsg(null);

    const pendingIndices = scannedPages
      .map((p, idx) => (p.readStatus !== 'done' ? idx : -1))
      .filter((idx) => idx >= 0);

    const targetIndices =
      pendingIndices.length > 0 ? pendingIndices : scannedPages.map((_, idx) => idx);
    const totalToRead = targetIndices.length;
    let completed = 0;
    let failedCount = 0;
    const startTs = Date.now();

    setQueueProgress({
      completed: 0,
      total: totalToRead,
      etaSeconds: totalToRead * 4,
      failedCount: 0,
    });

    let cursor = 0;
    const concurrency = 2; // P1: Max 2 concurrent requests

    const worker = async () => {
      while (cursor < targetIndices.length && !queueCancelledRef.current) {
        while (queuePausedRef.current && !queueCancelledRef.current) {
          await new Promise((r) => setTimeout(r, 300));
        }
        if (queueCancelledRef.current) break;

        const currentCursor = cursor++;
        if (currentCursor >= targetIndices.length) break;
        const pageIdx = targetIndices[currentCursor];

        try {
          await readSinglePageAtIndex(pageIdx);
        } catch (err: any) {
          failedCount += 1;
          updatePageAt(pageIdx, (p) => ({
            ...p,
            readStatus: 'failed',
            errorMsg: err?.message || 'فشل قراءة الصفحة',
          }));
        } finally {
          completed += 1;
          const elapsedSecSoFar = Math.max(1, (Date.now() - startTs) / 1000);
          const avgSecPerPage = elapsedSecSoFar / completed;
          const remaining = Math.max(0, totalToRead - completed);
          setQueueProgress({
            completed,
            total: totalToRead,
            etaSeconds: Math.round(remaining * avgSecPerPage),
            failedCount,
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, targetIndices.length) }, () => worker())
    );

    setQueueRunning(false);
    setProgressStep('');
    if (!queueCancelledRef.current) {
      setOcrSubTab('days');
    }
  };

  // H2: Auto-detect orientation & regions via Gemini
  const handleAutoDetectOrientationAndRegions = async () => {
    if (!currentPage) return;
    setIsReading(true);
    setProgressStep('جاري فحص اتجاه الصفحة وتقسيم الورقتين تلقائياً (H2)...');
    setErrorMsg(null);
    try {
      const prep = await preprocessLedgerImage(currentPage.rawImageDataUrl, {
        rotationDeg: currentPage.rotationDeg,
        preset: 'color_preserve',
      });
      const api = ensureGoldApiBridge();
      if (!api.ocr.detectOrientation) return;
      const res = await api.ocr.detectOrientation({
        imageBase64: prep.processedBase64,
        mimeType: 'image/jpeg',
        modelName: settings.geminiModel || 'gemini-3.8-flash',
        passcode: sessionStorage.getItem('app_passcode') || '',
      });
      if (res.ok && res.data) {
        const addRot = Number(res.data.orientationDeg) || 0;
        if (addRot > 0) {
          updatePageAt(selectedPageIdx, (p) => ({
            ...p,
            rotationDeg: (((p.rotationDeg + addRot) % 360) as 0 | 90 | 180 | 270) || 0,
          }));
        }
        if (Array.isArray(res.data.regions) && res.data.regions.length > 0) {
          const mapped: LedgerPageRegion[] = res.data.regions.map((r, idx) => ({
            id: `reg-${idx}`,
            label: r.label || `منطقة ${idx + 1}`,
            side: r.side === 'buy' || r.side === 'sell' ? r.side : 'both',
            x: Math.max(0, Math.min(0.95, Number(r.x) || 0)),
            y: Math.max(0, Math.min(0.95, Number(r.y) || 0)),
            w: Math.max(0.05, Math.min(1, Number(r.w) || 1)),
            h: Math.max(0.05, Math.min(1, Number(r.h) || 1)),
          }));
          setCustomRegions(mapped);
          setShowRegionEditor(true);
        }
        setSuccessBanner(
          `تم فحص الصفحة: التدوير المقترح (${addRot}°) وعدد المناطق المكتشفة (${
            res.data.regions?.length || 1
          }).`
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر كشف اتجاه الصفحة تلقائياً');
    } finally {
      setIsReading(false);
      setProgressStep('');
    }
  };

  // P2: Try Low Quality Scan Boost and compare confident cell counts
  const handleTryLowQualityBoostComparison = async () => {
    if (!currentPage) return;
    const prevRows = currentPage.rows;
    const prevConfidentCount = prevRows.filter((r) => r.confidence >= 0.75).length;

    setIsReading(true);
    setProgressStep('جاري تجربة إعدادات تحسين المسح الضعيف (P2) ومقارنة الثقة...');
    setErrorMsg(null);
    try {
      const updated = await readSinglePageAtIndex(selectedPageIdx, 'low_quality_boost');
      const boostedConfidentCount = updated.rows.filter((r) => r.confidence >= 0.75).length;
      setAbCompareBanner({
        normalConfidentCount: prevConfidentCount,
        boostedConfidentCount,
        recommended: boostedConfidentCount >= prevConfidentCount ? 'boosted' : 'normal',
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'فشل تجربة الإعدادات البديلة');
    } finally {
      setIsReading(false);
      setProgressStep('');
    }
  };

  // P4: Second-pass verification ONLY for weak cells (confidence < 0.7)
  const handleVerifyWeakCellsOnly = async () => {
    if (!currentPage) return;
    const weakRows = currentPage.rows.filter((r) => r.confidence < 0.7);
    if (weakRows.length === 0) {
      setSuccessBanner(
        'جميع خلايا هذه الصفحة ذات ثقة 70% فأعلى — لا توجد خلايا ضعيفة تحتاج قراءة ثانية.'
      );
      return;
    }

    setIsReading(true);
    setProgressStep(`جاري قص وإرسال ${weakRows.length} خلية ضعيفة الثقة فقط في طلب واحد (P4)...`);
    setErrorMsg(null);
    try {
      const cellsPayload: Array<{
        cellId: string;
        field: 'weight' | 'total' | 'item';
        firstReadValue: string | number;
        imageBase64: string;
      }> = [];

      for (const r of weakRows) {
        const yRatio = r.yRatio ?? 0.5;
        const croppedBase64 = await cropWeakRowStripBase64(
          currentPage.rawImageDataUrl,
          currentPage.rotationDeg,
          r.type,
          yRatio
        );
        cellsPayload.push({
          cellId: r.id,
          field: 'total',
          firstReadValue: r.total,
          imageBase64: croppedBase64,
        });
      }

      const api = ensureGoldApiBridge();
      if (!api.ocr.verifyWeakCells) return;
      const res = await api.ocr.verifyWeakCells({
        cells: cellsPayload,
        modelName: settings.geminiModel || 'gemini-3.8-flash',
        passcode: sessionStorage.getItem('app_passcode') || '',
      });

      if (res.ok && Array.isArray(res.verifications)) {
        const resultMap = new Map<string, { verifiedValue: string; confidence: number }>();
        for (const item of res.verifications) {
          if (item.cellId) resultMap.set(item.cellId, item);
        }

        updatePageAt(selectedPageIdx, (p) => ({
          ...p,
          rows: p.rows.map((row) => {
            const verified = resultMap.get(row.id);
            if (!verified) return row;
            const newT = parseAmountInput(String(verified.verifiedValue || ''));
            const totalDiff = newT > 0 && Math.abs(newT - row.total) > 2;

            if (totalDiff) {
              return {
                ...row,
                altTotal: newT,
                hasPassDiscrepancy: true,
              };
            }
            return {
              ...row,
              confidence: Math.max(row.confidence, Number(verified.confidence) || 0.88),
            };
          }),
        }));
        setSuccessBanner(`تمت المراجعة الثانية لعدد ${weakRows.length} صف ضعيف الثقة بنجاح.`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر إجراء القراءة الثانية للخلايا الضعيفة');
    } finally {
      setIsReading(false);
      setProgressStep('');
    }
  };

  // H1 & H3: Compute Discovered Days via groupPagesIntoDays
  const discoveredDays = useMemo<DiscoveredLedgerDay[]>(() => {
    return groupPagesIntoDays(scannedPages, {
      excludeFridays: settings.excludeFridays,
      smallDiffAmount: settings.ledgerTotalSmallDiffAmount || 50,
      largeDiffAmount: settings.ledgerTotalLargeDiffAmount || 200,
      weightToleranceG: settings.ledgerTotalWeightToleranceG || 0.25,
      manualDayOverrides,
    });
  }, [
    scannedPages,
    manualDayOverrides,
    settings.excludeFridays,
    settings.ledgerTotalSmallDiffAmount,
    settings.ledgerTotalLargeDiffAmount,
    settings.ledgerTotalWeightToleranceG,
  ]);

  // Commit discovered days to the ledger
  const commitDaysToLedger = async (daysToCommit: DiscoveredLedgerDay[]) => {
    if (daysToCommit.length === 0) return;
    setErrorMsg(null);

    // H3.6: Check if any day has an unapproved large diff when blockImportOnUnapprovedLargeDiff is enabled
    if (settings.blockImportOnUnapprovedLargeDiff) {
      const blockedDay = daysToCommit.find(
        (d) =>
          (d.totalsMatch.sell.status === 'large_diff' &&
            !d.totalsMatch.sell.approvedByAuditor) ||
          (d.totalsMatch.buy.status === 'large_diff' &&
            !d.totalsMatch.buy.approvedByAuditor)
      );
      if (blockedDay) {
        setErrorMsg(
          `لا يمكن اعتماد يوم (${blockedDay.date}) لوجود فرق كبير مع إجمالي الدفتر المكتوب بخط اليد دون تأشير "معتمد رغم الفرق".`
        );
        return;
      }
    }

    let totalAddedRows = 0;
    const committedPageIds = new Set<string>();

    for (const day of daysToCommit) {
      const approvedRows = day.rows.filter(
        (r) => r.approved && r.weightG > 0 && r.total > 0
      );
      if (approvedRows.length === 0) continue;

      const effectivePrice =
        day.goldPricePerGram || findSuggestedGoldPrice(day.date, daysMap);

      const batchRes = addOperationsBatch(
        approvedRows.map((r) => {
          const dayPageIdx = day.pageIds.indexOf(r.pageId);
          return {
            date: day.date,
            kind: r.type,
            karat: 21,
            weightG: r.weightG,
            total: r.total,
            item: r.item,
            payment: 'cash',
            runningBalanceBefore: r.runningBalanceBefore,
            runningBalanceAfter: r.runningBalanceAfter,
            rowOrderInPage: r.rowOrderInPage,
            ocrConfidence: r.confidence,
            bookMarks: r.bookMarks,
            sourcePageRef: {
              pageIndex: dayPageIdx >= 0 ? dayPageIdx + 1 : 1,
              pageImageKey: `${day.date}__p${dayPageIdx >= 0 ? dayPageIdx + 1 : 1}`,
              rowYRatio: r.yRatio,
              side: r.type,
            },
          };
        }),
        effectivePrice,
        `دفتر مصور (${fileName})`
      );

      if (!batchRes.ok) {
        setErrorMsg(batchRes.error || `تعذر إضافة عمليات يوم ${day.date}`);
        return;
      }

      totalAddedRows += batchRes.addedCount;

      // Save DayInfo metadata (H1, H3, H4, P5)
      const ledgerPagesMeta: DayLedgerPageMeta[] = [];
      for (let i = 0; i < day.pageIds.length; i++) {
        const pid = day.pageIds[i];
        committedPageIds.add(pid);
        const pageObj = scannedPages.find((p) => p.id === pid);
        if (!pageObj) continue;

        const imageKey = `${day.date}__p${i + 1}`;
        let savedUrl: string | undefined;
        if (attachImageToDay) {
          try {
            const prep = await preprocessLedgerImage(pageObj.rawImageDataUrl, {
              rotationDeg: pageObj.rotationDeg,
              preset: 'color_preserve',
              maxDimensionPx: 1800,
            });
            savedUrl = prep.colorDataUrl;
            const api = ensureGoldApiBridge();
            await api.storage.saveImage(imageKey, savedUrl);
            if (i === 0) {
              await saveDayLedgerImage(day.date, savedUrl);
            }
          } catch {
            // ignore image save error
          }
        }

        ledgerPagesMeta.push({
          pageIndex: i + 1,
          imageKey,
          side: pageObj.side,
          kind: pageObj.kind,
          pageNumberHint: pageObj.pageNumberHint || undefined,
          dataUrl: savedUrl,
        });
      }

      updateDayInfo(day.date, {
        openingLedgerBalance: day.openingBalance ?? undefined,
        closingLedgerBalance: day.closingBalance ?? undefined,
        ledgerPages: ledgerPagesMeta,
        ledgerTotalsComparison: {
          sell: day.totalsMatch.sell,
          buy: day.totalsMatch.buy,
        },
      });
    }

    setScannedPages((prev) =>
      prev.map((p) =>
        committedPageIds.has(p.id) ? { ...p, importStatus: 'added' } : p
      )
    );

    if (scannedPages.every((p) => committedPageIds.has(p.id) || p.kind === 'blank')) {
      await clearLedgerJobState();
    }

    setSuccessBanner(
      `تم اعتماد وإضافة ${daysToCommit.length} يوم (${totalAddedRows} عملية) إلى اليومية بنجاح.`
    );
    onAddedSuccess();
  };

  // Filtered rows for current page in Reader tab (H5 filter)
  const filteredCurrentPageRows = useMemo(() => {
    if (!currentPage) return [];
    return currentPage.rows.filter((r) => {
      if (redMarkFilter === 'has_mark') {
        return Boolean(r.bookMarks && r.bookMarks.length > 0);
      }
      if (redMarkFilter === 'no_mark') {
        return !r.bookMarks || r.bookMarks.length === 0;
      }
      if (redMarkFilter === 'discrepant_red_number') {
        return hasDiscrepantRedNumber(r).hasDiff;
      }
      return true;
    });
  }, [currentPage, redMarkFilter]);

  // Export Import Quality Report (H6.7)
  const handleExportImportQualityReport = async () => {
    await exportToExcelFormat({
      reportTitle: `جودة استيراد الدفتر المصور`,
      filenamePrefix: `جودة-استيراد-${fileName}`,
      shopName: settings.shopName,
      auditorName: settings.auditorName,
      columns: [
        { key: 'pageNumber', label: 'رقم الصفحة', isNumeric: true },
        { key: 'kindLabel', label: 'التصنيف' },
        { key: 'date', label: 'التاريخ' },
        { key: 'rowsCount', label: 'عدد الصفوف', isNumeric: true },
        { key: 'avgConf', label: 'متوسط الثقة' },
        { key: 'yellowCount', label: 'خلايا صفراء (<70%)', isNumeric: true },
        { key: 'redMarksCount', label: 'علامات حمراء', isNumeric: true },
        { key: 'importStatusLabel', label: 'حالة الإضافة' },
      ],
      rows: scannedPages.map((p) => ({
        pageNumber: p.pageNumber,
        kindLabel:
          p.kind === 'day_start'
            ? 'بداية يوم'
            : p.kind === 'continuation'
            ? 'تكملة يوم'
            : p.kind === 'blank'
            ? 'فارغة'
            : p.kind === 'cover'
            ? 'غلاف'
            : 'غير مقروءة',
        date: p.detectedDate || '—',
        rowsCount: p.rows.length,
        avgConf: `${Math.round(p.avgConfidence * 100)}%`,
        yellowCount: p.rows.filter((r) => r.confidence < 0.7).length,
        redMarksCount: p.redMarks.length,
        importStatusLabel:
          p.importStatus === 'added'
            ? 'أُضيفت'
            : p.importStatus === 'rejected'
            ? 'مرفوضة'
            : 'لم تُضف',
      })),
    });
  };

  return (
    <div className="space-y-5 pb-12" dir="rtl">
      {/* Top Mode Switcher: Universal Import (G3) vs Scanned Ledger OCR (Part 4) */}
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
          <span>قراءة الدفتر المصوّر أو الممسوح (CamScanner PDF / صور متعددة)</span>
        </button>
      </div>

      {importMode === 'universal' ? (
        <UniversalImportPanel
          onAddedSuccess={onAddedSuccess}
          onForwardFileToPhotoOcr={(file) => loadFilesForOcr([file])}
        />
      ) : (
        <>
          {/* H6.6 & P1: Resumable Job Banner */}
          {resumableJob && scannedPages.length === 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-amber-950">
                <RotateCcw className="w-4 h-4 text-amber-700 shrink-0" />
                <div>
                  <p className="font-bold">
                    يوجد ملف دفتر محفوظ غير مكتمل ({resumableJob.fileName} —{' '}
                    {resumableJob.pages.length} صفحة)
                  </p>
                  <p className="text-[11px] text-amber-800">
                    تم حفظ حالة القراءة تلقائياً. يمكنك استئناف المراجعة والاعتماد من حيث توقفت.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFileName(resumableJob.fileName);
                    setScannedPages(resumableJob.pages);
                    setManualDayOverrides(resumableJob.manualDayOverrides || {});
                    setSelectedPageIdx(0);
                    setResumableJob(null);
                  }}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg"
                >
                  استئناف الملف المحفوظ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearLedgerJobState();
                    setResumableJob(null);
                  }}
                  className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 text-xs font-bold rounded-lg"
                >
                  تجاهل وحذف
                </button>
              </div>
            </div>
          )}

          {/* Upload & Multi-Page Queue Header */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  قراءة الدفتر الورقي المصوّر وتجميع الأيام ومطابقة الإجماليات
                </h2>
                <p className="text-xs text-slate-500">
                  ارفع صورة واحدة، عدة صور متتالية، أو ملف PDF كامل من CamScanner مع تجميع تلقائي للأيام وفحص الجمع التراكمي.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>ارفع صور الدفتر أو ملف PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowDictionaryModal(true)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  title="قاموس التصحيحات الذكي المتعلم من تعديلاتك (P3)"
                >
                  <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                  <span>قاموس التصحيحات ({dictionary.items.length})</span>
                </button>
              </div>
            </div>

            {pdfLoading && (
              <div className="p-3 bg-slate-100 rounded-lg text-xs font-bold text-slate-700">
                جاري تحويل صفحات ملف الـ PDF إلى صور عالية الوضوح (220 DPI)...
              </div>
            )}

            {/* Sub-Navigation Tabs when pages are loaded */}
            {scannedPages.length > 0 && (
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setOcrSubTab('reader')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition ${
                      ocrSubTab === 'reader'
                        ? 'bg-slate-900 text-amber-400 shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>
                      1. قارئ الصفحة والجدول ({selectedPageIdx + 1}/{scannedPages.length})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOcrSubTab('days')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition ${
                      ocrSubTab === 'days'
                        ? 'bg-slate-900 text-amber-400 shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>
                      2. الأيام المكتشفة ومطابقة الإجماليات ({discoveredDays.length})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOcrSubTab('file_map')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition ${
                      ocrSubTab === 'file_map'
                        ? 'bg-slate-900 text-amber-400 shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    <span>3. خريطة الملف الشاملة ({scannedPages.length} صفحة)</span>
                  </button>
                </div>

                {/* P1: Multi-Page Smart Queue Controls */}
                {scannedPages.length > 1 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {!queueRunning ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (scannedPages.length > 5) {
                            setShowQueueEstimateModal(true);
                          } else {
                            startMultiPageQueue();
                          }
                        }}
                        className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>قراءة كل الصفحات بالترتيب ({scannedPages.length} صفحة)</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 px-3 py-1.5 rounded-lg text-xs">
                        <span className="font-bold text-amber-950">
                          جاري القراءة: {queueProgress.completed}/{queueProgress.total} (المتبقي ~
                          {queueProgress.etaSeconds} ث)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            queuePausedRef.current = !queuePausedRef.current;
                            setQueuePaused(queuePausedRef.current);
                          }}
                          className="px-2 py-0.5 bg-white border border-amber-400 rounded font-bold text-amber-900 inline-flex items-center gap-1"
                        >
                          <Pause className="w-3 h-3" />
                          <span>{queuePaused ? 'استئناف' : 'إيقاف مؤقت'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            queueCancelledRef.current = true;
                            setQueueRunning(false);
                          }}
                          className="px-2 py-0.5 bg-rose-600 text-white rounded font-bold"
                        >
                          إلغاء
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 font-bold flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="text-red-600 hover:underline text-[11px]"
                >
                  إغلاق
                </button>
              </div>
            )}

            {successBanner && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 font-bold flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{successBanner}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSuccessBanner(null)}
                  className="text-emerald-700 hover:underline text-[11px]"
                >
                  إغلاق
                </button>
              </div>
            )}
          </div>

          {/* =====================================================================
              SUB-TAB 1: PAGE READER & EDITABLE TABLE (H2, H4, H5, P2, P3, P4)
             ===================================================================== */}
          {ocrSubTab === 'reader' && currentPage && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                {scannedPages.length > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 text-xs">
                    <div className="flex items-center gap-2 font-bold text-slate-800">
                      <FileText className="w-4 h-4 text-amber-600" />
                      <span>اختر الصفحة للمعاينة أو التعديل اليدوي:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 max-h-24 overflow-y-auto">
                      {scannedPages.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedPageIdx(idx);
                            setAbCompareBanner(null);
                          }}
                          className={`px-2.5 py-1 rounded-lg font-mono font-bold transition-colors inline-flex items-center gap-1 ${
                            selectedPageIdx === idx
                              ? 'bg-slate-900 text-amber-400'
                              : p.readStatus === 'done'
                              ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                              : p.readStatus === 'failed'
                              ? 'bg-red-50 border border-red-300 text-red-900'
                              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>ص {idx + 1}</span>
                          {p.readStatus === 'done' && <Check className="w-3 h-3" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* H2 & P2 Pre-processing Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updatePageAt(selectedPageIdx, (p) => ({
                          ...p,
                          rotationDeg: (((p.rotationDeg + 90) % 360) as 0 | 90 | 180 | 270) || 0,
                        }))
                      }
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg inline-flex items-center gap-1.5"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>تدوير ({currentPage.rotationDeg}°)</span>
                    </button>

                    <button
                      type="button"
                      disabled={isReading}
                      onClick={handleAutoDetectOrientationAndRegions}
                      className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-bold rounded-lg inline-flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      <span>كشف الاتجاه والمناطق تلقائياً (H2)</span>
                    </button>

                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                      <Scissors className="w-3.5 h-3.5 text-slate-500 mx-1" />
                      {(
                        [
                          { id: 'both_split', label: 'النصفين (بيع + شراء)' },
                          { id: 'right_sell', label: 'المبيعات (الأيمن)' },
                          { id: 'left_buy', label: 'المشتريات (الأيسر)' },
                          { id: 'full', label: 'الصفحة كاملة' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setCropMode(m.id);
                            setCustomRegions(getDefaultLedgerRegions(m.id));
                          }}
                          className={`px-2 py-1 rounded font-semibold transition-colors ${
                            cropMode === m.id
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowRegionEditor((v) => !v)}
                      className={`px-2.5 py-1.5 rounded-lg border font-semibold inline-flex items-center gap-1 ${
                        showRegionEditor
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>تعديل حدود القص</span>
                    </button>
                  </div>

                  {/* Enhancement Mode + Read Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <select
                      value={enhancementPreset}
                      onChange={(e) => setEnhancementPreset(e.target.value as any)}
                      className="px-2.5 py-1.5 bg-slate-100 border border-slate-300 rounded-lg font-bold text-slate-800"
                    >
                      <option value="standard">تحسين تلقائي (إزالة ظلال + تباين H2)</option>
                      <option value="low_quality_boost">
                        تعزيز المسح الضعيف (تكبير + تقوية الحبر P2)
                      </option>
                      <option value="color_preserve">بدون معالجة مسبقة (الصورة الخام)</option>
                    </select>

                    <label className="inline-flex items-center gap-1 cursor-pointer font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={sliceHorizontally}
                        onChange={(e) => setSliceHorizontally(e.target.checked)}
                        className="rounded text-amber-600"
                      />
                      <span>شريحتين 12%</span>
                    </label>

                    <label className="inline-flex items-center gap-1 cursor-pointer font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={readTwiceAndCompare}
                        onChange={(e) => setReadTwiceAndCompare(e.target.checked)}
                        className="rounded text-amber-600"
                      />
                      <span>قراءة مرتين</span>
                    </label>

                    <button
                      type="button"
                      disabled={isReading}
                      onClick={requestStartReading}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>
                        {isReading ? `جاري القراءة (${elapsedSec} ث)...` : 'اقرأ هذه الصفحة'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* H2 Interactive Region Crop Editor */}
                {showRegionEditor && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                    <div className="font-bold text-slate-800">
                      تعديل حدود مناطق القراءة كنسبة من الصفحة (0 إلى 100%) (H2):
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {customRegions.map((reg, rIdx) => (
                        <div
                          key={reg.id}
                          className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-2"
                        >
                          <div className="flex items-center justify-between font-bold text-slate-700">
                            <span>{reg.label}</span>
                            <select
                              value={reg.side}
                              onChange={(e) => {
                                const next = [...customRegions];
                                next[rIdx] = {
                                  ...reg,
                                  side: e.target.value as 'sell' | 'buy' | 'both',
                                };
                                setCustomRegions(next);
                              }}
                              className="px-2 py-0.5 border border-slate-300 rounded text-[11px]"
                            >
                              <option value="sell">مبيعات (بيع)</option>
                              <option value="buy">مشتريات (شراء)</option>
                              <option value="both">تلقائي (بيع + شراء)</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-4 gap-2 font-mono text-[11px]">
                            <label>
                              X%:
                              <input
                                type="number"
                                min={0}
                                max={95}
                                value={Math.round(reg.x * 100)}
                                onChange={(e) => {
                                  const next = [...customRegions];
                                  next[rIdx] = {
                                    ...reg,
                                    x: (Number(e.target.value) || 0) / 100,
                                  };
                                  setCustomRegions(next);
                                }}
                                className="w-full px-1.5 py-0.5 border rounded"
                              />
                            </label>
                            <label>
                              Y%:
                              <input
                                type="number"
                                min={0}
                                max={95}
                                value={Math.round(reg.y * 100)}
                                onChange={(e) => {
                                  const next = [...customRegions];
                                  next[rIdx] = {
                                    ...reg,
                                    y: (Number(e.target.value) || 0) / 100,
                                  };
                                  setCustomRegions(next);
                                }}
                                className="w-full px-1.5 py-0.5 border rounded"
                              />
                            </label>
                            <label>
                              العرض%:
                              <input
                                type="number"
                                min={5}
                                max={100}
                                value={Math.round(reg.w * 100)}
                                onChange={(e) => {
                                  const next = [...customRegions];
                                  next[rIdx] = {
                                    ...reg,
                                    w: (Number(e.target.value) || 50) / 100,
                                  };
                                  setCustomRegions(next);
                                }}
                                className="w-full px-1.5 py-0.5 border rounded"
                              />
                            </label>
                            <label>
                              الارتفاع%:
                              <input
                                type="number"
                                min={5}
                                max={100}
                                value={Math.round(reg.h * 100)}
                                onChange={(e) => {
                                  const next = [...customRegions];
                                  next[rIdx] = {
                                    ...reg,
                                    h: (Number(e.target.value) || 100) / 100,
                                  };
                                  setCustomRegions(next);
                                }}
                                className="w-full px-1.5 py-0.5 border rounded"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* P2 & P4 Post-Read Smart Action Buttons */}
                {currentPage.rows.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isReading}
                        onClick={handleTryLowQualityBoostComparison}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-900 font-bold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                        <span>جرّب إعدادات أخرى للمسح الضعيف وقارن (P2)</span>
                      </button>

                      <button
                        type="button"
                        disabled={isReading}
                        onClick={handleVerifyWeakCellsOnly}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-bold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Search className="w-3.5 h-3.5 text-amber-700" />
                        <span>
                          قراءة ثانية للخلايا ضعيفة الثقة فقط (
                          {currentPage.rows.filter((r) => r.confidence < 0.7).length} خلية) (P4)
                        </span>
                      </button>
                    </div>

                    {abCompareBanner && (
                      <div className="px-3 py-1 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-950 font-bold">
                        مقارنة P2: العادية ({abCompareBanner.normalConfidentCount} خلية واثقة) مقابل المحسّنة ({abCompareBanner.boostedConfidentCount} خلية واثقة) — التوصية:{' '}
                        {abCompareBanner.recommended === 'boosted'
                          ? 'الإعدادات المحسّنة أفضل ✅'
                          : 'الإعدادات العادية كافية ✅'}
                      </div>
                    )}
                  </div>
                )}

                {isReading && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900 font-bold">
                    <span>{progressStep || 'جاري معالجة الصورة وإرسالها...'}</span>
                    <span className="font-mono">الزمن المنقضي: {elapsedSec} ثانية</span>
                  </div>
                )}
              </div>

              {/* Side-by-Side Image Viewer & Editable Table */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Original Zoomable Image Panel */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">
                      الصورة الأصلية (صفحة {selectedPageIdx + 1} من {scannedPages.length})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}
                        className="p-1 bg-white border border-slate-200 rounded hover:bg-slate-100"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-mono px-1">{Math.round(imageZoom * 100)}%</span>
                      <button
                        type="button"
                        onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}
                        className="p-1 bg-white border border-slate-200 rounded hover:bg-slate-100"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="p-3 bg-slate-900 overflow-auto max-h-[680px] flex items-center justify-center">
                    <img
                      src={currentPage.rawImageDataUrl}
                      alt="صفحة دفتر اليومية"
                      referrerPolicy="no-referrer"
                      style={{
                        transform: `scale(${imageZoom}) rotate(${currentPage.rotationDeg}deg)`,
                        transformOrigin: 'top center',
                      }}
                      className="max-w-full h-auto transition-transform duration-150 rounded"
                    />
                  </div>
                </div>

                {/* Editable Review Table Panel */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden space-y-4 p-4">
                  {/* Page Classification, Date, Gold Price, Opening/Closing Balances */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          تصنيف الصفحة (H1)
                        </label>
                        <select
                          value={currentPage.manualKindOverride || currentPage.kind}
                          onChange={(e) =>
                            setScannedPages((prev) =>
                              updatePageClassification(
                                prev,
                                currentPage.id,
                                e.target.value as LedgerPageKind
                              )
                            )
                          }
                          className="px-2 py-1 text-xs font-bold border-2 border-slate-300 rounded bg-white"
                        >
                          <option value="day_start">بداية يوم جديد</option>
                          <option value="continuation">تكملة لليوم السابق</option>
                          <option value="blank">صفحة فارغة</option>
                          <option value="cover">غلاف / فهرس</option>
                          <option value="unreadable">غير مقروءة</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          تاريخ الصفحة
                        </label>
                        <input
                          type="date"
                          value={currentPage.detectedDate || ''}
                          onChange={(e) =>
                            updatePageAt(selectedPageIdx, (p) => ({
                              ...p,
                              detectedDate: e.target.value,
                            }))
                          }
                          className="px-2 py-1 text-xs font-mono font-bold border-2 border-slate-300 rounded"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          سعر الذهب (عيار 21)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={currentPage.dayGoldPrice || ''}
                          placeholder="سعر 21..."
                          onChange={(e) =>
                            updatePageAt(selectedPageIdx, (p) => ({
                              ...p,
                              dayGoldPrice: parseAmountInput(e.target.value),
                            }))
                          }
                          className="w-24 px-2 py-1 text-xs font-mono font-bold border-2 border-slate-300 rounded"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          رصيد أول الصفحة (H4)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={currentPage.openingBalance ?? ''}
                          placeholder="اختياري..."
                          onChange={(e) =>
                            updatePageAt(selectedPageIdx, (p) => ({
                              ...p,
                              openingBalance: e.target.value
                                ? parseAmountInput(e.target.value)
                                : null,
                            }))
                          }
                          className="w-24 px-2 py-1 text-xs font-mono border border-slate-300 rounded"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          رصيد آخر الصفحة (H4)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={currentPage.closingBalance ?? ''}
                          placeholder="اختياري..."
                          onChange={(e) =>
                            updatePageAt(selectedPageIdx, (p) => ({
                              ...p,
                              closingBalance: e.target.value
                                ? parseAmountInput(e.target.value)
                                : null,
                            }))
                          }
                          className="w-24 px-2 py-1 text-xs font-mono border border-slate-300 rounded"
                        />
                      </div>
                    </div>

                    {currentPage.rows.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={attachImageToDay}
                            onChange={(e) => setAttachImageToDay(e.target.checked)}
                            className="rounded border-slate-300 text-amber-600"
                          />
                          <span>أرفق الصورة باليوم (P5)</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const targetDay = discoveredDays.find((d) =>
                              d.pageIds.includes(currentPage.id)
                            );
                            if (targetDay) {
                              commitDaysToLedger([targetDay]);
                            }
                          }}
                          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            اعتماد وإضافة اليوم ({currentPage.rows.filter((r) => r.approved).length}{' '}
                            صف)
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* H5 Red Ink Marks Filter & Summary Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700">تصفية علامات القلم الأحمر (H5):</span>
                      <select
                        value={redMarkFilter}
                        onChange={(e) => setRedMarkFilter(e.target.value as any)}
                        className="px-2 py-1 bg-white border border-slate-300 rounded font-bold text-slate-800"
                      >
                        <option value="all">كل الصفوف ({currentPage.rows.length})</option>
                        <option value="has_mark">
                          عليها علامة في الدفتر (
                          {
                            currentPage.rows.filter((r) => r.bookMarks && r.bookMarks.length > 0)
                              .length
                          }
                          )
                        </option>
                        <option value="no_mark">
                          بلا علامة في الدفتر (
                          {
                            currentPage.rows.filter(
                              (r) => !r.bookMarks || r.bookMarks.length === 0
                            ).length
                          }
                          )
                        </option>
                        <option value="discrepant_red_number">
                          فيها رقم أحمر مخالف لرقم الصف (
                          {currentPage.rows.filter((r) => hasDiscrepantRedNumber(r).hasDiff).length}
                          )
                        </option>
                      </select>
                    </div>

                    {currentPage.redMarks.some((m) => m.type === 'circle') && (
                      <button
                        type="button"
                        onClick={() => {
                          const count = convertRedCirclesToReviewedFlag(
                            currentPage.detectedDate || undefined
                          );
                          setSuccessBanner(
                            `تم تحويل علامة الدائرة الحمراء إلى علامة مراجعة لعدد ${count} عملية مسجلة.`
                          );
                        }}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-900 rounded font-bold"
                      >
                        ⭕ حوّل الدائرة الحمراء إلى علامة مراجعة
                      </button>
                    )}
                  </div>

                  {/* Editable Rows Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-right border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                          <th className="py-2 px-1.5 w-8 text-center">✓</th>
                          <th className="py-2 px-1.5 w-16">النوع</th>
                          <th className="py-2 px-2">البيان</th>
                          <th className="py-2 px-1.5 w-24">الوزن (ج)</th>
                          <th className="py-2 px-1.5 w-28">الإجمالي</th>
                          <th className="py-2 px-1.5 w-24">الرصيد بعد (H4)</th>
                          <th className="py-2 px-1.5 w-28">علامات الدفتر (H5)</th>
                          <th className="py-2 px-1.5 w-14 text-center">الثقة</th>
                          <th className="py-2 px-1 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCurrentPageRows.map((r) => {
                          const realIdx = currentPage.rows.findIndex((x) => x.id === r.id);
                          const lowConf = r.confidence < 0.7;
                          const gramPrice = r.weightG > 0 ? r.total / r.weightG : 0;
                          const pGoldPrice = currentPage.dayGoldPrice || 0;
                          const logicalMismatch =
                            pGoldPrice > 0 &&
                            gramPrice > 0 &&
                            Math.abs(gramPrice - pGoldPrice) / pGoldPrice > 0.12;

                          const cellBg =
                            r.hasPassDiscrepancy || logicalMismatch
                              ? 'bg-red-100 border-red-500'
                              : lowConf
                              ? 'bg-yellow-100 border-yellow-500'
                              : 'bg-white border-slate-200';

                          // P3 digit confusion suggestion if logical mismatch
                          const digitFixSuggestion =
                            logicalMismatch && settings.enableSelfLearningDictionary !== false
                              ? suggestDigitConfusionFix(
                                  r.total,
                                  r.weightG,
                                  pGoldPrice,
                                  dictionary
                                )
                              : null;

                          return (
                            <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                              <td className="py-1.5 px-1.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={r.approved}
                                  onChange={(e) => {
                                    updatePageAt(selectedPageIdx, (p) => {
                                      const next = [...p.rows];
                                      next[realIdx] = { ...r, approved: e.target.checked };
                                      return { ...p, rows: next };
                                    });
                                  }}
                                  className="rounded text-emerald-600"
                                />
                              </td>
                              <td className="py-1.5 px-1.5">
                                <select
                                  value={r.type}
                                  onChange={(e) => {
                                    updatePageAt(selectedPageIdx, (p) => {
                                      const next = [...p.rows];
                                      next[realIdx] = {
                                        ...r,
                                        type: e.target.value as 'buy' | 'sell',
                                      };
                                      return { ...p, rows: next };
                                    });
                                  }}
                                  className="px-1 py-1 border border-slate-200 rounded bg-white font-bold"
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
                                    const newVal = e.target.value;
                                    updatePageAt(selectedPageIdx, (p) => {
                                      const next = [...p.rows];
                                      next[realIdx] = { ...r, item: newVal };
                                      return { ...p, rows: next };
                                    });
                                  }}
                                  onBlur={(e) => {
                                    if (
                                      settings.enableSelfLearningDictionary !== false &&
                                      r.item &&
                                      e.target.value &&
                                      r.item !== e.target.value
                                    ) {
                                      setDictionary(learnItemCorrection(r.item, e.target.value));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-slate-200 rounded bg-white"
                                />
                              </td>
                              <td className="py-1.5 px-1.5">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={r.weightG}
                                  onChange={(e) => {
                                    const newW = parseWeightInput(
                                      e.target.value,
                                      settings.shortSpaceWeightMode
                                    );
                                    if (
                                      settings.enableSelfLearningDictionary !== false &&
                                      newW !== r.weightG
                                    ) {
                                      setDictionary(learnDigitCorrection(r.weightG, newW));
                                    }
                                    updatePageAt(selectedPageIdx, (p) => {
                                      const next = [...p.rows];
                                      next[realIdx] = { ...r, weightG: newW };
                                      return { ...p, rows: next };
                                    });
                                  }}
                                  className={`w-full px-1.5 py-1 font-mono font-bold border rounded ${cellBg}`}
                                />
                                {r.altWeightG !== undefined && r.altWeightG !== r.weightG && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      updatePageAt(selectedPageIdx, (p) => {
                                        const next = [...p.rows];
                                        next[realIdx] = {
                                          ...r,
                                          weightG: r.altWeightG!,
                                          hasPassDiscrepancy: false,
                                        };
                                        return { ...p, rows: next };
                                      });
                                    }}
                                    className="mt-0.5 text-[10px] text-red-700 underline block"
                                  >
                                    قراءة 2: {formatWeight(r.altWeightG)}
                                  </button>
                                )}
                              </td>
                              <td className="py-1.5 px-1.5">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={r.total}
                                  onChange={(e) => {
                                    const newT = parseAmountInput(e.target.value);
                                    if (
                                      settings.enableSelfLearningDictionary !== false &&
                                      newT !== r.total
                                    ) {
                                      setDictionary(learnDigitCorrection(r.total, newT));
                                    }
                                    updatePageAt(selectedPageIdx, (p) => {
                                      const next = [...p.rows];
                                      next[realIdx] = { ...r, total: newT };
                                      return { ...p, rows: next };
                                    });
                                  }}
                                  className={`w-full px-1.5 py-1 font-mono font-bold border rounded ${cellBg}`}
                                />
                                {r.altTotal !== undefined && r.altTotal !== r.total && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      updatePageAt(selectedPageIdx, (p) => {
                                        const next = [...p.rows];
                                        next[realIdx] = {
                                          ...r,
                                          total: r.altTotal!,
                                          hasPassDiscrepancy: false,
                                        };
                                        return { ...p, rows: next };
                                      });
                                    }}
                                    className="mt-0.5 text-[10px] text-red-700 underline block"
                                  >
                                    قراءة 2: {formatNumber(r.altTotal)}
                                  </button>
                                )}
                                {digitFixSuggestion && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      updatePageAt(selectedPageIdx, (p) => {
                                        const next = [...p.rows];
                                        next[realIdx] = {
                                          ...r,
                                          total: digitFixSuggestion.suggestedTotal,
                                        };
                                        return { ...p, rows: next };
                                      });
                                    }}
                                    className="mt-0.5 text-[10px] text-indigo-700 font-bold underline block"
                                    title={digitFixSuggestion.reason}
                                  >
                                    اقتراح القاموس: {formatNumber(digitFixSuggestion.suggestedTotal)}
                                  </button>
                                )}
                              </td>
                              <td className="py-1.5 px-1.5">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={r.runningBalanceAfter ?? ''}
                                  placeholder="—"
                                  onChange={(e) => {
                                    const val = e.target.value
                                      ? parseAmountInput(e.target.value)
                                      : undefined;
                                    updatePageAt(selectedPageIdx, (p) => {
                                      const next = [...p.rows];
                                      next[realIdx] = { ...r, runningBalanceAfter: val };
                                      return { ...p, rows: next };
                                    });
                                  }}
                                  className="w-full px-1.5 py-1 font-mono border border-slate-200 rounded bg-slate-50"
                                />
                              </td>
                              <td className="py-1.5 px-1.5">
                                {r.bookMarks && r.bookMarks.length > 0 ? (
                                  <div className="space-y-1">
                                    {r.bookMarks.map((m, mIdx) => (
                                      <div
                                        key={mIdx}
                                        className="px-1.5 py-0.5 bg-rose-50 border border-rose-200 text-rose-800 rounded text-[10px] font-bold"
                                      >
                                        <span>
                                          {m.type === 'circle'
                                            ? '⭕ دائرة'
                                            : m.type === 'tick'
                                            ? '✔ صح'
                                            : m.type === 'strike'
                                            ? '➖ شطب'
                                            : m.type === 'number'
                                            ? `🔢 ${m.text}`
                                            : `✍ ${m.text || 'علامة'}`}
                                        </span>
                                        {m.suggestedCorrectionValue &&
                                          Math.abs(m.suggestedCorrectionValue - r.total) > 1 && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                updatePageAt(selectedPageIdx, (p) => {
                                                  const next = [...p.rows];
                                                  next[realIdx] = {
                                                    ...r,
                                                    total: m.suggestedCorrectionValue!,
                                                  };
                                                  return { ...p, rows: next };
                                                });
                                              }}
                                              className="block text-[10px] text-rose-900 underline mt-0.5"
                                            >
                                              اعتمد الرقم الأحمر (
                                              {formatNumber(m.suggestedCorrectionValue)})
                                            </button>
                                          )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-1.5 px-1.5 text-center font-mono">
                                {r.singlePassOnly ? (
                                  <span className="px-1 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold block">
                                    قراءة 1
                                  </span>
                                ) : (
                                  <span>{Math.round(r.confidence * 100)}%</span>
                                )}
                              </td>
                              <td className="py-1.5 px-1 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updatePageAt(selectedPageIdx, (p) => ({
                                      ...p,
                                      rows: p.rows.filter((_, i) => i !== realIdx),
                                    }))
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
                      updatePageAt(selectedPageIdx, (p) => ({
                        ...p,
                        rows: [
                          ...p.rows,
                          {
                            id: `manual-${Date.now()}`,
                            approved: true,
                            type: 'sell',
                            item: '',
                            weightG: 0,
                            total: 0,
                            confidence: 1,
                            pageId: p.id,
                            pageNumber: p.pageNumber,
                            rowOrderInPage: p.rows.length + 1,
                          },
                        ],
                      }))
                    }
                    className="text-xs font-bold text-amber-700 hover:underline inline-flex items-center gap-1"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>إضافة صف يدوي للجدول</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              SUB-TAB 2: DISCOVERED DAYS & HANDWRITTEN TOTALS MATCHING (H1 & H3)
             ===================================================================== */}
          {ocrSubTab === 'days' && (
            <div className="space-y-4">
              {/* Top Commit All Clean Days Action */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    الأيام المكتشفة في الملف ({discoveredDays.length} يوم)
                  </h3>
                  <p className="text-xs text-slate-500">
                    يمكنك دمج يومين، فصل صفحة تكملة كيوم مستقل، تأكيد سعر الذهب مرة واحدة لكل يوم، ومطابقة إجماليات الدفتر المكتوبة بخط اليد (H3).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => commitDaysToLedger(discoveredDays)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-lg inline-flex items-center gap-2 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>اعتماد وإضافة كل الأيام المكتشفة ({discoveredDays.length})</span>
                </button>
              </div>

              {/* Discovered Day Cards */}
              <div className="space-y-4">
                {discoveredDays.map((day) => {
                  const statusBadge = (st: string) => {
                    if (st === 'match')
                      return (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded font-bold text-[11px]">
                          ✅ مطابق لإجمالي الدفتر
                        </span>
                      );
                    if (st === 'small_diff')
                      return (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded font-bold text-[11px]">
                          ⚠ فرق صغير مع الدفتر
                        </span>
                      );
                    if (st === 'large_diff')
                      return (
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-900 rounded font-bold text-[11px]">
                          ❌ فرق كبير مع الدفتر
                        </span>
                      );
                    return (
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-bold text-[11px]">
                        ❔ لا يوجد إجمالي مكتوب
                      </span>
                    );
                  };

                  return (
                    <div
                      key={day.id}
                      className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 shadow-xs"
                    >
                      {/* H1 Sequence Warnings & Orphan Continuations */}
                      {day.sequenceWarnings.length > 0 && (
                        <div className="space-y-1.5">
                          {day.sequenceWarnings.map((w, wIdx) => (
                            <div
                              key={wIdx}
                              className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-950 font-bold flex flex-wrap items-center justify-between gap-2"
                            >
                              <span>⚠ {w.message}</span>
                              <div className="flex items-center gap-2">
                                {w.suggestedDate && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setManualDayOverrides((prev) => ({
                                        ...prev,
                                        [day.id]: { ...prev[day.id], date: w.suggestedDate },
                                      }))
                                    }
                                    className="px-2.5 py-1 bg-amber-600 text-white rounded text-[11px]"
                                  >
                                    تطبيق التاريخ المقترح ({w.suggestedDate})
                                  </button>
                                )}
                                {w.type === 'orphan_continuation' && day.pageIds[0] && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setScannedPages((prev) =>
                                        updatePageClassification(
                                          prev,
                                          day.pageIds[0],
                                          'day_start',
                                          getTodayIso()
                                        )
                                      )
                                    }
                                    className="px-2.5 py-1 bg-slate-900 text-white rounded text-[11px]"
                                  >
                                    تحويلها إلى بداية يوم مستقل
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Day Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500">
                              تاريخ اليوم
                            </label>
                            <input
                              type="date"
                              value={day.date}
                              onChange={(e) =>
                                setManualDayOverrides((prev) => ({
                                  ...prev,
                                  [day.id]: { ...prev[day.id], date: e.target.value },
                                }))
                              }
                              className="px-2.5 py-1 text-xs font-mono font-bold border border-slate-300 rounded"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-500">
                              سعر الذهب لليوم (يرثه كل صفحات التكملة H1.6)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={day.goldPricePerGram || ''}
                              onChange={(e) =>
                                setManualDayOverrides((prev) => ({
                                  ...prev,
                                  [day.id]: {
                                    ...prev[day.id],
                                    goldPricePerGram: parseAmountInput(e.target.value),
                                  },
                                }))
                              }
                              className="w-28 px-2.5 py-1 text-xs font-mono font-bold border border-slate-300 rounded"
                            />
                          </div>

                          <div className="text-xs text-slate-600">
                            <span className="font-bold text-slate-900">
                              الصفحات ({day.pageNumbers.length}):
                            </span>{' '}
                            {day.pageNumbers.map((n) => `ص ${n}`).join(' + ')} |{' '}
                            <span className="text-emerald-700 font-bold">
                              مبيعات: {day.sellRowsCount}
                            </span>{' '}
                            ·{' '}
                            <span className="text-sky-700 font-bold">
                              مشتريات: {day.buyRowsCount}
                            </span>
                          </div>
                        </div>

                        {/* Merge / Commit Day Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          {mergeSourceDayId === day.id ? (
                            <span className="text-xs font-bold text-amber-700">
                              اختر اليوم الثاني للدمج معه...
                            </span>
                          ) : mergeSourceDayId ? (
                            <button
                              type="button"
                              onClick={() => {
                                const srcDay = discoveredDays.find(
                                  (d) => d.id === mergeSourceDayId
                                );
                                if (srcDay) {
                                  setScannedPages((prev) =>
                                    mergeTwoDiscoveredDays(prev, day.pageIds, srcDay.pageIds)
                                  );
                                }
                                setMergeSourceDayId(null);
                              }}
                              className="px-2.5 py-1 bg-amber-600 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1"
                            >
                              <Merge className="w-3.5 h-3.5" />
                              <span>ادمج هنا</span>
                            </button>
                          ) : (
                            discoveredDays.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setMergeSourceDayId(day.id)}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg inline-flex items-center gap-1"
                              >
                                <Merge className="w-3.5 h-3.5" />
                                <span>دمج مع يوم آخر</span>
                              </button>
                            )
                          )}

                          <button
                            type="button"
                            onClick={() => commitDaysToLedger([day])}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>اعتماد هذا اليوم</span>
                          </button>
                        </div>
                      </div>

                      {/* Pages Thumbnails & Split Action */}
                      {day.pageIds.length > 1 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs bg-slate-50 p-2.5 rounded-lg">
                          <span className="font-bold text-slate-700">صفحات هذا اليوم:</span>
                          {day.pageIds.map((pid, orderIdx) => {
                            const pIdx = scannedPages.findIndex((p) => p.id === pid);
                            return (
                              <div
                                key={pid}
                                className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded border border-slate-200"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (pIdx >= 0) setSelectedPageIdx(pIdx);
                                    setOcrSubTab('reader');
                                  }}
                                  className="font-bold text-slate-800 hover:text-amber-600"
                                >
                                  صفحة {day.pageNumbers[orderIdx]} (
                                  {orderIdx === 0 ? 'بداية' : 'تكملة'})
                                </button>
                                {orderIdx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setScannedPages((prev) =>
                                        splitDayFromPage(prev, pid, day.date)
                                      )
                                    }
                                    className="text-[10px] text-indigo-700 hover:underline inline-flex items-center gap-0.5"
                                    title="فصل هذه الصفحة كبداية يوم جديد"
                                  >
                                    <Split className="w-3 h-3" />
                                    <span>فصل كيوم جديد</span>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* H3: Side Totals Matching Cards (Sell & Buy) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(
                          [
                            {
                              side: 'sell' as const,
                              title: 'مطابقة إجمالي المبيعات (الجانب الأيمن)',
                              comp: day.totalsMatch.sell,
                            },
                            {
                              side: 'buy' as const,
                              title: 'مطابقة إجمالي المشتريات (الجانب الأيسر)',
                              comp: day.totalsMatch.buy,
                            },
                          ] as const
                        ).map(({ side, title, comp }) => (
                          <div
                            key={side}
                            className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-800">{title}</span>
                              {statusBadge(comp.status)}
                            </div>

                            <div className="grid grid-cols-3 gap-2 font-mono bg-white p-2 rounded border border-slate-200 text-[11px]">
                              <div>
                                <span className="block text-slate-400">مجموع الصفوف:</span>
                                <strong className="text-slate-900">
                                  {formatNumber(comp.readSumAmount)} ج.م
                                </strong>
                                <span className="block text-[10px] text-slate-500">
                                  ({formatWeight(comp.readSumWeightG)} ج)
                                </span>
                              </div>
                              <div>
                                <span className="block text-slate-400">إجمالي الدفتر:</span>
                                <strong className="text-slate-900">
                                  {comp.handwrittenAmount !== null &&
                                  comp.handwrittenAmount !== undefined
                                    ? `${formatNumber(comp.handwrittenAmount)} ج.م`
                                    : 'غير مكتوب'}
                                </strong>
                                {comp.handwrittenWeightG !== null &&
                                  comp.handwrittenWeightG !== undefined && (
                                    <span className="block text-[10px] text-slate-500">
                                      ({formatWeight(comp.handwrittenWeightG)} ج)
                                    </span>
                                  )}
                              </div>
                              <div>
                                <span className="block text-slate-400">الفرق:</span>
                                <strong
                                  className={
                                    Math.abs(comp.diffAmount) <= 1
                                      ? 'text-emerald-700'
                                      : 'text-rose-700'
                                  }
                                >
                                  {comp.diffAmount > 0 ? '+' : ''}
                                  {formatNumber(comp.diffAmount)} ج.م
                                </strong>
                              </div>
                            </div>

                            {/* H3.2: Multiple Handwritten Candidates Selector */}
                            {comp.candidates && comp.candidates.length > 1 && (
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="font-bold text-slate-700">
                                  إجماليات مكتوبة متعددة:
                                </span>
                                <select
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setManualDayOverrides((prev) => ({
                                      ...prev,
                                      [day.id]: {
                                        ...prev[day.id],
                                        [side === 'sell'
                                          ? 'approvedSellTotal'
                                          : 'approvedBuyTotal']: val,
                                      },
                                    }));
                                  }}
                                  className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono"
                                >
                                  {comp.candidates.map((c, cIdx) => (
                                    <option key={cIdx} value={c}>
                                      {formatNumber(c)} ج.م
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Manual Total Override & "أين الفرق؟" Button */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-600">إجمالي معتمد يدوي:</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="اختياري..."
                                  value={
                                    (side === 'sell'
                                      ? manualDayOverrides[day.id]?.approvedSellTotal
                                      : manualDayOverrides[day.id]?.approvedBuyTotal) ?? ''
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value
                                      ? parseAmountInput(e.target.value)
                                      : undefined;
                                    setManualDayOverrides((prev) => ({
                                      ...prev,
                                      [day.id]: {
                                        ...prev[day.id],
                                        [side === 'sell'
                                          ? 'approvedSellTotal'
                                          : 'approvedBuyTotal']: val,
                                      },
                                    }));
                                  }}
                                  className="w-24 px-2 py-0.5 bg-white border border-slate-300 rounded font-mono text-[11px]"
                                />
                              </div>

                              {Math.abs(comp.diffAmount) > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSuspectModalInfo({
                                      dayDate: day.date,
                                      side,
                                      diffAmount: comp.diffAmount,
                                      diffWeightG: comp.diffWeightG,
                                      dayGoldPrice: day.goldPricePerGram,
                                      rows: day.rows,
                                    })
                                  }
                                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold text-[11px] inline-flex items-center gap-1"
                                >
                                  <HelpCircle className="w-3.5 h-3.5" />
                                  <span>أين الفرق؟ (ترتيب الصفوف المشتبهة)</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* H3.6: Large Diff Approval Checkbox */}
                      {(day.totalsMatch.sell.status === 'large_diff' ||
                        day.totalsMatch.buy.status === 'large_diff') && (
                        <label className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-300 rounded-lg text-xs font-bold text-rose-950 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(
                              manualDayOverrides[day.id]?.auditorApprovedDiff
                            )}
                            onChange={(e) =>
                              setManualDayOverrides((prev) => ({
                                ...prev,
                                [day.id]: {
                                  ...prev[day.id],
                                  auditorApprovedDiff: e.target.checked,
                                },
                              }))
                            }
                            className="rounded text-rose-600"
                          />
                          <span>
                            أعتمد هذا اليوم كمراجع رغم وجود فرق كبير مع إجمالي الدفتر المكتوب بخط اليد (مطلوب للإضافة H3.6)
                          </span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* =====================================================================
              SUB-TAB 3: FILE MAP SCREEN (خريطة الملف — H6)
             ===================================================================== */}
          {ocrSubTab === 'file_map' && (
            <div className="space-y-4">
              {/* H6.2 Summary Bar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div>
                      <span className="text-slate-500">إجمالي الصفحات:</span>{' '}
                      <strong className="font-mono text-sm text-slate-900">
                        {scannedPages.length}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">الأيام المكتشفة:</span>{' '}
                      <strong className="font-mono text-sm text-amber-700">
                        {discoveredDays.length}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">إجمالي العمليات:</span>{' '}
                      <strong className="font-mono text-sm text-emerald-700">
                        {scannedPages.reduce((s, p) => s + p.rows.length, 0)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">صفحات عالية الثقة:</span>{' '}
                      <strong className="font-mono text-sm text-slate-900">
                        {scannedPages.length > 0
                          ? Math.round(
                              (scannedPages.filter((p) => p.avgConfidence >= 0.8).length /
                                scannedPages.length) *
                                100
                            )
                          : 0}
                        %
                      </strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExportImportQualityReport}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg inline-flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تقرير جودة الاستيراد (Excel)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const cleanDays = discoveredDays.filter(
                          (d) =>
                            d.totalsMatch.sell.status !== 'large_diff' &&
                            d.totalsMatch.buy.status !== 'large_diff'
                        );
                        commitDaysToLedger(cleanDays);
                      }}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-lg inline-flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>اعتمد وأضف الأيام السليمة دفعة واحدة (H6.5)</span>
                    </button>
                  </div>
                </div>

                {/* H6.3 Attention Filter Tabs */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
                  {(
                    [
                      { id: 'all', label: `كل الصفحات (${scannedPages.length})` },
                      {
                        id: 'needs_attention',
                        label: `تحتاج انتباه فقط (${
                          scannedPages.filter(
                            (p) =>
                              p.readStatus === 'failed' ||
                              p.kind === 'unreadable' ||
                              p.rows.some((r) => r.confidence < 0.7 || r.hasPassDiscrepancy)
                          ).length
                        })`,
                      },
                      {
                        id: 'not_added',
                        label: `لم تُضف بعد (${
                          scannedPages.filter((p) => p.importStatus === 'pending').length
                        })`,
                      },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFileMapFilter(f.id)}
                      className={`px-3 py-1 rounded-lg font-bold transition ${
                        fileMapFilter === f.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* H6.1 File Map Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                        <th className="py-2 px-2">#</th>
                        <th className="py-2 px-2">معاينة</th>
                        <th className="py-2 px-2">التصنيف</th>
                        <th className="py-2 px-2">اليوم المنتمية إليه</th>
                        <th className="py-2 px-2">عدد الصفوف</th>
                        <th className="py-2 px-2">متوسط الثقة</th>
                        <th className="py-2 px-2">خلايا صفراء / علامات حمراء</th>
                        <th className="py-2 px-2">حالة الإضافة</th>
                        <th className="py-2 px-2">إجراءات سريعة (H6.4)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scannedPages
                        .filter((p) => {
                          if (fileMapFilter === 'needs_attention') {
                            return (
                              p.readStatus === 'failed' ||
                              p.kind === 'unreadable' ||
                              p.rows.some((r) => r.confidence < 0.7 || r.hasPassDiscrepancy)
                            );
                          }
                          if (fileMapFilter === 'not_added') {
                            return p.importStatus === 'pending';
                          }
                          return true;
                        })
                        .map((p, pIdx) => {
                          const assignedDay = discoveredDays.find((d) =>
                            d.pageIds.includes(p.id)
                          );
                          const yellowCount = p.rows.filter((r) => r.confidence < 0.7).length;

                          return (
                            <tr
                              key={p.id}
                              className="border-b border-slate-200 hover:bg-slate-50"
                            >
                              <td className="py-2 px-2 font-mono font-bold">
                                صفحة {p.pageNumber}
                              </td>
                              <td className="py-2 px-2">
                                <img
                                  src={p.rawImageDataUrl}
                                  alt={`ص ${p.pageNumber}`}
                                  className="w-12 h-14 object-cover rounded border border-slate-300"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-800">
                                  {p.kind === 'day_start'
                                    ? 'بداية يوم'
                                    : p.kind === 'continuation'
                                    ? 'تكملة يوم'
                                    : p.kind === 'blank'
                                    ? 'فارغة'
                                    : p.kind === 'cover'
                                    ? 'غلاف'
                                    : 'غير مقروءة'}
                                </span>
                              </td>
                              <td className="py-2 px-2 font-mono font-bold">
                                {assignedDay ? assignedDay.date : p.detectedDate || '—'}
                              </td>
                              <td className="py-2 px-2 font-mono">{p.rows.length} صف</td>
                              <td className="py-2 px-2 font-mono">
                                {Math.round(p.avgConfidence * 100)}%
                              </td>
                              <td className="py-2 px-2 font-mono">
                                <span className="text-amber-700 font-bold">
                                  {yellowCount} صفراء
                                </span>{' '}
                                ·{' '}
                                <span className="text-rose-700 font-bold">
                                  {p.redMarks.length} حمراء
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                {p.importStatus === 'added' ? (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded font-bold text-[11px]">
                                    أُضيفت ✅
                                  </span>
                                ) : p.importStatus === 'rejected' ? (
                                  <span className="px-2 py-0.5 bg-rose-100 text-rose-900 rounded font-bold text-[11px]">
                                    مرفوضة
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-bold text-[11px]">
                                    لم تُضف
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedPageIdx(pIdx);
                                      setOcrSubTab('reader');
                                    }}
                                    className="px-2 py-1 bg-slate-900 text-white rounded text-[11px] font-bold"
                                  >
                                    فتح في القارئ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => readSinglePageAtIndex(pIdx)}
                                    className="px-2 py-1 bg-amber-100 text-amber-900 rounded text-[11px] font-bold"
                                  >
                                    أعد القراءة
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updatePageAt(pIdx, (pg) => ({
                                        ...pg,
                                        importStatus:
                                          pg.importStatus === 'rejected'
                                            ? 'pending'
                                            : 'rejected',
                                      }))
                                    }
                                    className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-[11px]"
                                  >
                                    {p.importStatus === 'rejected' ? 'إلغاء الرفض' : 'رفض الصفحة'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* H3.5 "أين الفرق؟" Suspect Rows Modal */}
          {suspectModalInfo && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900">
                    أين الفرق؟ — تحليل فرق الإجمالي ليوم {suspectModalInfo.dayDate} (
                    {suspectModalInfo.side === 'sell' ? 'المبيعات' : 'المشتريات'})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSuspectModalInfo(null)}
                    className="text-slate-400 hover:text-slate-700 text-xs font-bold"
                  >
                    إغلاق
                  </button>
                </div>
                <p className="text-xs text-slate-600">
                  الفرق الحالي مع إجمالي الدفتر:{' '}
                  <strong className="font-mono text-rose-700">
                    {formatNumber(suspectModalInfo.diffAmount)} ج.م
                  </strong>
                  . الصفوف التالية هي الأكثر اشتباهاً في التسبب بهذا الفرق:
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {rankSuspectRowsForDiff(
                    suspectModalInfo.rows,
                    suspectModalInfo.side,
                    suspectModalInfo.diffAmount,
                    suspectModalInfo.diffWeightG,
                    suspectModalInfo.dayGoldPrice
                  ).map((sus) => (
                    <div
                      key={sus.row.id}
                      className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs flex items-center justify-between gap-2"
                    >
                      <div>
                        <p className="font-bold text-slate-900">
                          {sus.row.item || 'بدون بيان'} — {formatWeight(sus.row.weightG)} ج —{' '}
                          {formatNumber(sus.row.total)} ج.م
                        </p>
                        <p className="text-[11px] text-amber-900 mt-0.5">
                          {sus.reasons.join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSuspectModalInfo(null);
                          setOcrSubTab('reader');
                        }}
                        className="px-2.5 py-1 bg-slate-900 text-white rounded text-[11px] font-bold shrink-0"
                      >
                        افحص الصف
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* P3 Self-Learning Dictionary Modal */}
          {showDictionaryModal && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900">
                    قاموس التصحيحات الذكي المتعلم محلياً (P3)
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowDictionaryModal(false)}
                    className="text-slate-500 hover:text-slate-800 text-xs font-bold"
                  >
                    إغلاق
                  </button>
                </div>
                <p className="text-xs text-slate-600">
                  يتعلم البرنامج تلقائياً من تعديلاتك اليدوية لأسماء الأصناف والأرقام في جدول المعاينة لتطبيقها في الصفحات القادمة.
                </p>
                <div className="max-h-64 overflow-y-auto space-y-1.5 text-xs">
                  {dictionary.items.length === 0 ? (
                    <p className="text-slate-400 text-center py-4">
                      لا توجد تصحيحات محفوظة بعد.
                    </p>
                  ) : (
                    dictionary.items.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded border border-slate-200"
                      >
                        <span>
                          <code className="text-rose-700">{rule.rawVariant}</code> ←{' '}
                          <strong className="text-emerald-800">{rule.canonicalName}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next: LocalCorrectionDictionary = {
                              ...dictionary,
                              items: dictionary.items.filter((x) => x.id !== rule.id),
                            };
                            saveCorrectionDictionary(next);
                            setDictionary(next);
                          }}
                          className="text-slate-400 hover:text-rose-600 text-[11px]"
                        >
                          حذف
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      const empty: LocalCorrectionDictionary = {
                        items: [],
                        digitConfusions: [],
                      };
                      saveCorrectionDictionary(empty);
                      setDictionary(empty);
                    }}
                    className="px-3 py-1.5 bg-rose-50 text-rose-700 text-xs font-bold rounded-lg"
                  >
                    مسح القاموس بالكامل
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDictionaryModal(false)}
                    className="px-4 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg"
                  >
                    تم
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* P1 Pre-Run Queue Estimate Confirmation Modal */}
          {showQueueEstimateModal && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
                <h3 className="text-base font-extrabold text-slate-900">
                  تقدير وقت قراءة الملف الكبير (P1.7)
                </h3>
                {(() => {
                  const est = estimateOcrJobCostAndTime(scannedPages, {
                    cropMode,
                    sliceHorizontally,
                    readTwiceAndCompare,
                  });
                  return (
                    <div className="space-y-2 text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <p>
                        • عدد الصفحات الكلي: <strong>{est.totalPages} صفحة</strong>
                      </p>
                      <p>
                        • صفحات غير مقروءة: <strong>{est.unreadPages} صفحة</strong>
                      </p>
                      <p>
                        • إجمالي طلبات القراءة المتوقعة:{' '}
                        <strong>{est.estimatedRequests} طلب</strong>
                      </p>
                      <p>
                        • الوقت التقديري للانتهاء:{' '}
                        <strong>حوالي {Math.max(1, Math.ceil(est.estimatedSeconds / 60))} دقيقة</strong>
                      </p>
                    </div>
                  );
                })()}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQueueEstimateModal(false)}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={startMultiPageQueue}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg"
                  >
                    ابدأ القراءة الآن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Passcode Modal */}
          {showPasscodeModal && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl max-w-sm w-full p-5 space-y-4 shadow-xl">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                  <KeyRound className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>كلمة مرور الخادم مطلوبة</span>
                </div>
                <input
                  type="password"
                  autoFocus
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  placeholder="أدخل كلمة المرور..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
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
                      executeSinglePageOcr();
                    }}
                    className="px-4 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg"
                  >
                    حفظ ومتابعة
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Privacy Consent Modal */}
          {showConsentModal && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
                <div className="flex items-center gap-2 text-amber-800 font-bold text-base">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>تأكيد إرسال الصورة لقراءة الأرقام</span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  هذه الصورة سترسل إلى خدمة <strong>Gemini من Google</strong> لقراءة الأرقام المكتوبة بخط اليد وتحويلها إلى جدول.
                </p>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
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
                    onClick={executeSinglePageOcr}
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
