import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { ScannedLedgerPage } from './ledgerGrouping';

const JOB_STATE_IDB_KEY = 'gold_audit_active_ledger_ocr_job_v1';
const PAGE_OCR_CACHE_IDB_KEY = 'gold_audit_page_ocr_hash_cache_v1';

export interface PersistedLedgerJobState {
  jobId: string;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  pages: ScannedLedgerPage[];
  manualDayOverrides: Record<string, any>;
}

export interface OcrQueueEstimate {
  totalPages: number;
  unreadPages: number;
  cachedPages: number;
  estimatedRequests: number;
  estimatedSeconds: number;
}

// In-memory mirror of page OCR cache for fast synchronous/async lookup
let memoryOcrCache: Record<string, any> = {};
let cacheHydrated = false;

export async function hydratePageOcrCache(): Promise<void> {
  if (cacheHydrated) return;
  try {
    const stored = await idbGet<Record<string, any>>(PAGE_OCR_CACHE_IDB_KEY);
    if (stored && typeof stored === 'object') {
      memoryOcrCache = stored;
    }
    cacheHydrated = true;
  } catch {
    cacheHydrated = true;
  }
}

export async function getCachedPageOcrResult(cacheKey: string): Promise<any | null> {
  await hydratePageOcrCache();
  return memoryOcrCache[cacheKey] || null;
}

export async function setCachedPageOcrResult(cacheKey: string, ocrData: any): Promise<void> {
  await hydratePageOcrCache();
  memoryOcrCache[cacheKey] = ocrData;
  // Keep cache bounded to 150 page results
  const keys = Object.keys(memoryOcrCache);
  if (keys.length > 150) {
    delete memoryOcrCache[keys[0]];
  }
  try {
    await idbSet(PAGE_OCR_CACHE_IDB_KEY, memoryOcrCache);
  } catch {
    // ignore IDB write error
  }
}

/**
 * P1: Pre-estimates number of API requests and approximate duration before starting the queue
 */
export function estimateOcrJobCostAndTime(
  pages: ScannedLedgerPage[],
  options: {
    cropMode: 'both_split' | 'right_sell' | 'left_buy' | 'full';
    sliceHorizontally: boolean;
    readTwiceAndCompare: boolean;
  }
): OcrQueueEstimate {
  const unread = pages.filter((p) => p.readStatus !== 'done');
  let cachedCount = 0;
  for (const p of unread) {
    const key = `${p.imageHash}|${options.cropMode}|${options.sliceHorizontally}`;
    if (memoryOcrCache[key]) cachedCount++;
  }

  const netPagesToCall = Math.max(0, unread.length - cachedCount);
  const sidesFactor = options.cropMode === 'both_split' ? 2 : 1;
  const sliceFactor = options.sliceHorizontally ? 2 : 1;
  const passFactor = options.readTwiceAndCompare ? 2 : 1;
  const requestsPerPage = sidesFactor * sliceFactor * passFactor;
  const estimatedRequests = netPagesToCall * requestsPerPage;

  // With concurrency = 2, each request averages ~3.5s -> ~1.8s effective per request
  const estimatedSeconds = Math.ceil(estimatedRequests * 2.2);

  return {
    totalPages: pages.length,
    unreadPages: unread.length,
    cachedPages: cachedCount,
    estimatedRequests,
    estimatedSeconds,
  };
}

/**
 * H6.6 & P1: Persists the current multi-page import job state so the user can resume after closing the app
 */
export async function saveLedgerJobState(state: PersistedLedgerJobState): Promise<void> {
  try {
    await idbSet(JOB_STATE_IDB_KEY, {
      ...state,
      updatedAt: Date.now(),
    });
  } catch {
    // ignore IDB quota/write error
  }
}

export async function loadLedgerJobState(): Promise<PersistedLedgerJobState | null> {
  try {
    const loaded = await idbGet<PersistedLedgerJobState>(JOB_STATE_IDB_KEY);
    if (loaded && Array.isArray(loaded.pages) && loaded.pages.length > 0) {
      return loaded;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearLedgerJobState(): Promise<void> {
  try {
    await idbDel(JOB_STATE_IDB_KEY);
  } catch {
    // ignore
  }
}
