import React, { useEffect, useState, useRef } from 'react';
import { Lock, AlertTriangle, HelpCircle, ShieldAlert, Clock, KeyRound } from 'lucide-react';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

export const AppLockOverlay: React.FC = () => {
  const [lockEnabled, setLockEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [securityFilePath, setSecurityFilePath] = useState('GoldAudit/data/security.json');
  const [isLocked, setIsLocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showForgotHelp, setShowForgotHelp] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refreshLockConfig = async () => {
    const api = ensureGoldApiBridge();
    const res = await api.security.getStatus();
    if (res && res.ok) {
      setLockEnabled(res.enabled);
      setIdleMinutes(res.idleMinutes || 15);
      if (res.securityFilePath) setSecurityFilePath(res.securityFilePath);
      return res.enabled;
    }
    return false;
  };

  useEffect(() => {
    let mounted = true;
    refreshLockConfig().then((enabled) => {
      if (mounted && enabled) {
        setIsLocked(true);
      }
    });

    // Listen for custom event when user updates lock config in Settings
    const handleConfigChange = () => {
      refreshLockConfig();
    };
    window.addEventListener('gold-security-updated', handleConfigChange);
    return () => {
      mounted = false;
      window.removeEventListener('gold-security-updated', handleConfigChange);
    };
  }, []);

  // Track activity for idle auto-lock
  useEffect(() => {
    if (!lockEnabled) return;

    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener('mousemove', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('mousedown', updateActivity, { passive: true });
    window.addEventListener('touchstart', updateActivity, { passive: true });

    const interval = setInterval(() => {
      if (!isLocked && lockEnabled) {
        const elapsedMs = Date.now() - lastActivityRef.current;
        if (elapsedMs >= idleMinutes * 60 * 1000) {
          setIsLocked(true);
          setPasswordInput('');
          setErrorMsg('تم قفل البرنامج تلقائياً بسبب الخمول.');
        }
      }
    }, 10_000);

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('mousedown', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      clearInterval(interval);
    };
  }, [lockEnabled, idleMinutes, isLocked]);

  // Cooldown timer after 5 failed attempts
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const t = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          setFailedAttempts(0);
          setErrorMsg(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (isLocked && cooldownSeconds === 0) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isLocked, cooldownSeconds]);

  if (!isLocked) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownSeconds > 0) return;

    if (!passwordInput.trim()) {
      setErrorMsg('أدخل كلمة المرور لفتح البرنامج.');
      return;
    }

    const api = ensureGoldApiBridge();
    const res = await api.security.verifyPassword(passwordInput);
    if (res.ok && res.valid) {
      setIsLocked(false);
      setPasswordInput('');
      setFailedAttempts(0);
      setErrorMsg(null);
      lastActivityRef.current = Date.now();
    } else {
      const nextFails = failedAttempts + 1;
      setFailedAttempts(nextFails);
      setPasswordInput('');
      if (res.error) {
        setErrorMsg(res.error);
      } else if (nextFails >= 5) {
        setCooldownSeconds(60);
        setErrorMsg('تم إدخال كلمة مرور خاطئة 5 مرات. يرجى الانتظار دقيقة واحدة.');
      } else {
        setErrorMsg(`كلمة المرور غير صحيحة (محاولة ${nextFails} من 5).`);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500 flex items-center justify-center text-slate-950 shadow-lg">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold">البرنامج مقفول بكلمة مرور</h2>
              <p className="text-xs text-slate-400">مراجع الذهب — حماية سطح المكتب</p>
            </div>
          </div>
          {lockEnabled && (
            <button
              type="button"
              onClick={() => setIsLocked(true)}
              className="text-xs text-amber-400 font-bold"
            >
              قفل نشط
            </button>
          )}
        </div>

        <form onSubmit={handleUnlock} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {cooldownSeconds > 0 ? (
            <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-2">
              <Clock className="w-8 h-8 text-amber-600 mx-auto animate-pulse" />
              <div className="text-sm font-extrabold text-amber-900">
                الرجاء الانتظار {cooldownSeconds} ثانية قبل المحاولة مرة أخرى
              </div>
              <p className="text-xs text-amber-700">
                تم قفل المحاولات مؤقتاً بعد 5 محاولات غير صحيحة.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                كلمة مرور البرنامج
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="أدخل كلمة المرور ثم اضغط Enter..."
                  className="w-full h-12 px-4 pl-10 rounded-xl border-2 border-slate-300 focus:border-amber-500 focus:outline-none text-base font-bold"
                />
                <KeyRound className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={cooldownSeconds > 0}
            className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-extrabold text-sm transition shadow-sm cursor-pointer"
          >
            فتح البرنامج
          </button>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowForgotHelp(!showForgotHelp)}
              className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-slate-400" />
              نسيت كلمة المرور؟
            </button>
            <span className="text-[11px] text-slate-400">
              قفل تلقائي بعد {idleMinutes} دقيقة خمول
            </span>
          </div>

          {showForgotHelp && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1.5 leading-relaxed">
              <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                كيفية إلغاء قفل البرنامج يدوياً:
              </div>
              <p>
                كلمة المرور مخزنة بتشفير <code>scrypt</code> مع <code>salt</code> ولا توجد استعادة آلية لها.
              </p>
              <p>
                لإلغاء القفل عند نسيان كلمة المرور: أغلق البرنامج، ثم افتح مجلد بيانات البرنامج على جهازك واحذف ملف إعداد القفل فقط:
              </p>
              <div
                dir="ltr"
                className="p-2 rounded bg-slate-200/80 font-mono text-[11px] text-slate-800 break-all"
              >
                {securityFilePath}
              </div>
              <p className="text-[11px] text-slate-500">
                ملاحظة: بيانات العمليات والحسابات نفسها (<code>state.json</code>) محفوظة في ملف مستقل وغير مشفرة على القرص ولن تتأثر بحذف ملف القفل.
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
