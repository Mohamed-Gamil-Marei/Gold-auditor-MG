import React, { Component, ErrorInfo, ReactNode, useEffect, useState } from 'react';
import { AlertOctagon, AlertTriangle, Info, RefreshCw, Home, X } from 'lucide-react';
import {
  dismissErrorToast,
  NonIntrusiveToast,
  reportAppError,
  subscribeToErrorToasts,
} from '../../errors/catalog';

interface ScreenErrorBoundaryProps {
  screenName: string;
  onGoHome: () => void;
  children: ReactNode;
}

interface ScreenErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ScreenErrorBoundary extends Component<
  ScreenErrorBoundaryProps,
  ScreenErrorBoundaryState
> {
  constructor(props: ScreenErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'خطأ غير معروف أثناء عرض المكون',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    reportAppError({
      code: 'E-UI-080',
      screen: this.props.screenName,
      customMessage: error?.message || 'حدث خطأ في عرض الشاشة',
      stack: `${error?.stack || ''}\n${errorInfo?.componentStack || ''}`,
      silentToast: true,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white border-2 border-red-200 rounded-2xl p-8 max-w-xl mx-auto my-8 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-700 flex items-center justify-center mx-auto">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-extrabold text-slate-900">
              حدث خطأ في هذه الشاشة ({this.props.screenName})
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              جميع بياناتك وحساباتك محفوظة بأمان. تم عزل الخطأ في هذه الشاشة فقط وتم تسجيل التفاصيل في سجل التشخيص.
            </p>
          </div>
          {this.state.errorMessage && (
            <div
              dir="ltr"
              className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-600 break-all"
            >
              {this.state.errorMessage}
            </div>
          )}
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>إعادة المحاولة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                this.props.onGoHome();
              }}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Home className="w-4 h-4" />
              <span>العودة للرئيسية</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Non-intrusive Toast Notification Stack that NEVER steals keyboard focus from Fast Entry.
 */
export const NonIntrusiveToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<NonIntrusiveToast[]>([]);

  useEffect(() => {
    return subscribeToErrorToasts(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-14 left-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none no-print"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const isErr = t.severity === 'error';
        const isWarn = t.severity === 'warn';
        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border p-3 shadow-lg text-xs transition-all ${
              isErr
                ? 'bg-red-950/95 border-red-700 text-white'
                : isWarn
                ? 'bg-amber-950/95 border-amber-600 text-white'
                : 'bg-slate-900/95 border-slate-700 text-white'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-extrabold">
                {isErr ? (
                  <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                ) : isWarn ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 text-sky-400 shrink-0" />
                )}
                <span>{t.title}</span>
                <span className="font-mono text-[10px] opacity-75">[{t.code}]</span>
              </div>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => dismissErrorToast(t.id)}
                className="text-white/70 hover:text-white p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-200 leading-relaxed">{t.message}</p>
            {t.hint && (
              <p className="mt-1 text-[11px] text-amber-300 font-semibold">
                الحل المقترح: {t.hint}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
