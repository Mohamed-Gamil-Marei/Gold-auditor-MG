import React, { useEffect, useState } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  Maximize2,
  Eye,
} from 'lucide-react';
import { DayInfo, Operation } from '../../types';
import { ensureGoldApiBridge } from '../../utils/goldApiBridge';
import { formatNumber } from '../../utils/numerals';

interface LedgerPageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  dayInfo?: DayInfo;
  highlightOperation?: Operation | null;
}

interface LoadedPageItem {
  pageIndex: number;
  pageNumberHint?: string;
  kind: 'day_start' | 'continuation';
  imageDataUrl: string;
}

export const LedgerPageViewerModal: React.FC<LedgerPageViewerModalProps> = ({
  isOpen,
  onClose,
  date,
  dayInfo,
  highlightOperation,
}) => {
  const [pages, setPages] = useState<LoadedPageItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showHighlightBand, setShowHighlightBand] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const loadPages = async () => {
      setLoading(true);
      const api = ensureGoldApiBridge();
      const loaded: LoadedPageItem[] = [];

      if (dayInfo?.ledgerPages && dayInfo.ledgerPages.length > 0) {
        for (const p of dayInfo.ledgerPages) {
          let dataUrl = p.dataUrl || '';
          if (!dataUrl && p.imageKey && api.storage.loadImage) {
            const res = await api.storage.loadImage(p.imageKey);
            if (res.ok && res.dataUrl) {
              dataUrl = res.dataUrl;
            }
          }
          if (dataUrl) {
            loaded.push({
              pageIndex: p.pageIndex,
              pageNumberHint: p.pageNumberHint,
              kind: p.kind === 'continuation' ? 'continuation' : 'day_start',
              imageDataUrl: dataUrl,
            });
          }
        }
      }

      if (loaded.length === 0) {
        let singleUrl = dayInfo?.ledgerImageDataUrl || '';
        if (!singleUrl && api.storage.loadImage) {
          const res = await api.storage.loadImage(date);
          if (res.ok && res.dataUrl) {
            singleUrl = res.dataUrl;
          }
        }
        if (singleUrl) {
          loaded.push({
            pageIndex: 1,
            kind: 'day_start',
            imageDataUrl: singleUrl,
          });
        }
      }

      if (!cancelled) {
        setPages(loaded);
        setLoading(false);
        setZoom(1);
        setRotation(0);

        if (highlightOperation?.sourcePageRef?.pageIndex && loaded.length > 1) {
          const idx = loaded.findIndex(
            (p) => p.pageIndex === highlightOperation.sourcePageRef?.pageIndex
          );
          setActiveIndex(idx >= 0 ? idx : 0);
        } else {
          setActiveIndex(0);
        }
      }
    };

    loadPages();
    return () => {
      cancelled = true;
    };
  }, [isOpen, date, dayInfo, highlightOperation]);

  if (!isOpen) return null;

  const currentPage = pages[activeIndex];
  const rowYRatio =
    highlightOperation?.sourcePageRef?.rowYRatio ??
    (highlightOperation?.rowOrderInPage
      ? Math.min(0.92, Math.max(0.14, 0.14 + highlightOperation.rowOrderInPage * 0.045))
      : undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      dir="rtl"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-800/90 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>صورة صفحة الدفتر الأصلية — يوم {date}</span>
                {currentPage && (
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-amber-300">
                    {currentPage.kind === 'day_start' ? 'بداية يوم' : 'تكملة يوم'}
                    {currentPage.pageNumberHint ? ` (${currentPage.pageNumberHint})` : ''}
                  </span>
                )}
              </h3>
              {highlightOperation && (
                <p className="text-xs text-amber-300 mt-0.5">
                  معاينة السطر: {highlightOperation.item || 'بدون بيان'} — الوزن:{' '}
                  {formatNumber(highlightOperation.weightG, 2)} ج — الإجمالي:{' '}
                  {formatNumber(highlightOperation.total)} ج.م
                </p>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {pages.length > 1 && (
              <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-700 ml-2">
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  className="p-1 text-slate-300 hover:text-white disabled:opacity-40"
                  title="الصفحة السابقة"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-200 font-medium px-2">
                  صفحة {activeIndex + 1} من {pages.length}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.min(pages.length - 1, i + 1))}
                  disabled={activeIndex === pages.length - 1}
                  className="p-1 text-slate-300 hover:text-white disabled:opacity-40"
                  title="الصفحة التالية"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            )}

            {highlightOperation && rowYRatio !== undefined && (
              <button
                type="button"
                onClick={() => setShowHighlightBand((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                  showHighlightBand
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>تظليل موقع السطر</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              title="تكبير"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              title="تصغير"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setRotation(0);
              }}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs"
              title="الحجم الأصلي"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              title="تدوير 90 درجة"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 mr-1"
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewer Body */}
        <div className="flex-1 overflow-auto bg-slate-950 flex items-center justify-center p-6 relative">
          {loading ? (
            <div className="text-slate-400 text-sm">جاري تحميل صورة الدفتر...</div>
          ) : !currentPage ? (
            <div className="text-center text-slate-400 space-y-2">
              <BookOpen className="w-10 h-10 mx-auto text-slate-600" />
              <p className="text-sm font-medium">لا توجد صورة صفحة دفتر محفوظة لهذا اليوم ({date}).</p>
              <p className="text-xs text-slate-500">
                تُحفظ صورة الصفحة تلقائياً عند استيراد اليوم من شاشة &quot;رفع صور الدفتر&quot;.
              </p>
            </div>
          ) : (
            <div
              className="relative inline-block transition-transform duration-150 origin-center"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
              }}
            >
              <img
                src={currentPage.imageDataUrl}
                alt={`صفحة دفتر ${date}`}
                className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-xl border border-slate-800"
              />
              {highlightOperation && showHighlightBand && rowYRatio !== undefined && (
                <div
                  className="absolute left-0 right-0 pointer-events-none border-y-2 border-amber-400 bg-amber-400/20 shadow-[0_0_20px_rgba(251,191,36,0.45)] flex items-center justify-end px-3"
                  style={{
                    top: `${Math.max(2, Math.min(93, rowYRatio * 100 - 2.5))}%`,
                    height: '5.5%',
                  }}
                >
                  <span className="bg-amber-500 text-slate-950 font-bold text-[11px] px-2 py-0.5 rounded shadow">
                    السطر المحدد ({highlightOperation.item || 'عملية'})
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Page Thumbnails Footer when multi-page */}
        {pages.length > 1 && (
          <div className="px-5 py-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-3 overflow-x-auto">
            <span className="text-xs text-slate-400 shrink-0">صفحات اليوم ({pages.length}):</span>
            {pages.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition shrink-0 ${
                  idx === activeIndex
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>صفحة {p.pageIndex}</span>
                <span className="text-[10px] opacity-80">
                  ({p.kind === 'day_start' ? 'بداية' : 'تكملة'})
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
