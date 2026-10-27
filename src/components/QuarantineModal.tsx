import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  RotateCcw,
  Trash2,
  Wrench,
  FolderOpen,
  FileArchive,
  X,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { BackupFileInfo, QuarantinedRecord } from '../types';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';
import { exportProblemReportZip } from '../export/exportService';
import { getTodayIso } from '../utils/numerals';

export const QuarantineReviewModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const {
    quarantinedRecords,
    restoreQuarantinedRecord,
    deleteQuarantinedRecord,
  } = useAuditStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState(getTodayIso());
  const [editKind, setEditKind] = useState<'buy' | 'sell' | 'expense' | 'advance' | 'person'>('sell');
  const [editWeight, setEditWeight] = useState('1');
  const [editTotal, setEditTotal] = useState('1000');
  const [editName, setEditName] = useState('');

  if (!open) return null;

  const startRepair = (rec: QuarantinedRecord) => {
    setEditingId(rec.id);
    const raw = rec.rawData || {};
    setEditDate(/^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : getTodayIso());
    setEditKind(
      ['buy', 'sell', 'expense', 'advance', 'person'].includes(raw.kind) ? raw.kind : 'sell'
    );
    setEditWeight(
      Number.isFinite(Number(raw.weightG)) && Number(raw.weightG) >= 0
        ? String(raw.weightG)
        : '1'
    );
    setEditTotal(
      Number.isFinite(Number(raw.total)) && Number(raw.total) >= 0
        ? String(raw.total)
        : '1000'
    );
    setEditName(String(raw.name || raw.item || 'سجل مُصلح'));
  };

  const handleConfirmRepair = (rec: QuarantinedRecord) => {
    if (rec.entityType === 'operation') {
      restoreQuarantinedRecord(rec.id, {
        ...rec.rawData,
        id: rec.rawData?.id || `op-repaired-${Date.now()}`,
        date: editDate,
        kind: editKind,
        weightG: Math.max(0, Number(editWeight) || 0),
        total: Math.max(0, Number(editTotal) || 0),
        item: editName,
        payment: rec.rawData?.payment === 'credit' ? 'credit' : 'cash',
        reviewedFlag: false,
        note: 'تم الإصلاح والاستعادة من الحجر الصحي',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else if (rec.entityType === 'person') {
      restoreQuarantinedRecord(rec.id, {
        ...rec.rawData,
        id: rec.rawData?.id || `person-repaired-${Date.now()}`,
        name: editName.trim() || 'عميل مُصلح',
        type: 'client',
        createdAt: Date.now(),
      });
    } else if (rec.entityType === 'worker') {
      restoreQuarantinedRecord(rec.id, {
        ...rec.rawData,
        id: rec.rawData?.id || `worker-repaired-${Date.now()}`,
        name: editName.trim() || 'عامل مُصلح',
        monthlySalary: Math.max(0, Number(editTotal) || 0),
        dueDay: 30,
        createdAt: Date.now(),
      });
    }
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        <div className="px-5 py-4 bg-amber-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-extrabold">
                الحجر الصحي للسجلات التالفة ({quarantinedRecords.length})
              </h2>
              <p className="text-xs text-amber-200">
                سجلات تم عزلها تلقائياً أثناء القراءة لحماية الحسابات — يمكنك إصلاحها واستعادتها أو حذفها
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-3 bg-slate-50">
          {quarantinedRecords.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <div className="text-sm font-bold text-slate-900">
                لا توجد أي سجلات معزولة في الحجر الصحي.
              </div>
            </div>
          ) : (
            quarantinedRecords.map((rec) => (
              <div
                key={rec.id}
                className="bg-white border border-amber-300 rounded-xl p-4 space-y-3 shadow-2xs text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
                      النوع:{' '}
                      {rec.entityType === 'operation'
                        ? 'عملية يومية'
                        : rec.entityType === 'person'
                        ? 'شخص'
                        : rec.entityType === 'worker'
                        ? 'عامل'
                        : 'يومية'}
                    </span>
                    <span className="text-red-700 font-bold">السبب: {rec.reason}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startRepair(rec)}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>إصلاح واستعادة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteQuarantinedRecord(rec.id)}
                      className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>

                <pre
                  dir="ltr"
                  className="p-2.5 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] overflow-x-auto"
                >
                  {JSON.stringify(rec.rawData, null, 2)}
                </pre>

                {editingId === rec.id && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-3">
                    <div className="font-bold text-amber-950">
                      أدخل القيم الصحيحة لإصلاح السجل وإعادته للبرنامج:
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {rec.entityType === 'operation' && (
                        <>
                          <div>
                            <label className="block text-[11px] font-bold mb-1">التاريخ</label>
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className="w-full px-2 py-1 font-mono bg-white border border-slate-300 rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold mb-1">الوزن (جرام)</label>
                            <input
                              type="number"
                              step="0.001"
                              value={editWeight}
                              onChange={(e) => setEditWeight(e.target.value)}
                              className="w-full px-2 py-1 font-mono bg-white border border-slate-300 rounded"
                            />
                          </div>
                        </>
                      )}
                      <div>
                        <label className="block text-[11px] font-bold mb-1">
                          {rec.entityType === 'worker' ? 'المرتب الشهري' : 'المبلغ (ج.م)'}
                        </label>
                        <input
                          type="number"
                          value={editTotal}
                          onChange={(e) => setEditTotal(e.target.value)}
                          className="w-full px-2 py-1 font-mono bg-white border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold mb-1">البيان / الاسم</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 bg-white border border-slate-300 rounded font-bold"
                      >
                        إلغاء
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmRepair(rec)}
                        className="px-3.5 py-1 bg-emerald-600 text-white rounded font-bold cursor-pointer"
                      >
                        تأكيد الإصلاح والاستعادة
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * G1.6: 10-Minute Pre-Operation Safety Snapshot Undo Banner
 */
export const SafetySnapshotUndoBanner: React.FC = () => {
  const { activeSafetySnapshot, undoSafetySnapshot, dismissSafetySnapshot, settings } =
    useAuditStore();
  const [remainingSecs, setRemainingSecs] = useState(0);

  useEffect(() => {
    if (!activeSafetySnapshot) return;
    const updateTimer = () => {
      const left = Math.max(
        0,
        Math.floor((activeSafetySnapshot.expiresAt - Date.now()) / 1000)
      );
      setRemainingSecs(left);
      if (left <= 0) {
        dismissSafetySnapshot();
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeSafetySnapshot, dismissSafetySnapshot]);

  if (!activeSafetySnapshot || remainingSecs <= 0) return null;

  const mins = Math.floor(remainingSecs / 60);
  const secs = remainingSecs % 60;

  return (
    <div className="bg-indigo-950 text-white px-4 py-2 text-xs font-bold border-b border-indigo-700 no-print">
      <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            لقطة أمان متاحة: تم تنفيذ ({activeSafetySnapshot.label}). يمكنك التراجع الكامل واستعادة الحالة السابقة خلال{' '}
            <span className="font-mono text-amber-300">
              {mins}:{String(secs).padStart(2, '0')}
            </span>{' '}
            دقيقة.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={undoSafetySnapshot}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-lg inline-flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>تراجع عن العملية</span>
          </button>
          <button
            type="button"
            onClick={dismissSafetySnapshot}
            className="px-2 py-1 text-indigo-200 hover:text-white cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * G1.5: Safe Mode (وضع الأمان) Read-Only Banner & Recovery Panel
 */
export const SafeModeRecoveryBar: React.FC = () => {
  const { safeMode, safeModeReason, exitSafeMode, importFullBackup, settings } =
    useAuditStore();
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [showBackupsModal, setShowBackupsModal] = useState(false);

  useEffect(() => {
    if (safeMode) {
      ensureGoldApiBridge()
        .storage.listBackups()
        .then((res) => {
          if (res.ok && res.backups) setBackups(res.backups);
        })
        .catch(() => {});
    }
  }, [safeMode]);

  if (!safeMode) return null;

  return (
    <>
      <div className="bg-red-900 text-white px-4 py-3 border-b-2 border-red-500 text-xs font-bold no-print">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0" />
            <div>
              <div className="text-sm font-extrabold text-amber-300">
                وضع الأمان المفعّل (قراءة فقط لحماية البيانات)
              </div>
              <div className="text-red-100">
                {safeModeReason ||
                  'واجه البرنامج مشكلة متكررة أثناء التحميل فتم فتحه في وضع القراءة الآمنة لمنع الكتابة فوق النسخ السليمة.'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBackupsModal(true)}
              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold rounded-lg cursor-pointer"
            >
              استعادة آخر نسخة سليمة ({backups.length})
            </button>
            <button
              type="button"
              onClick={() => ensureGoldApiBridge().storage.openDataFolder()}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>فتح مجلد البيانات</span>
            </button>
            <button
              type="button"
              onClick={() => exportProblemReportZip(settings)}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>تصدير سجل الخطأ (.zip)</span>
            </button>
            <button
              type="button"
              onClick={exitSafeMode}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg cursor-pointer"
            >
              الخروج من وضع الأمان وتفعيل الحفظ
            </button>
          </div>
        </div>
      </div>

      {showBackupsModal && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                النسخ الاحتياطية المتوفرة للاستعادة من وضع الأمان
              </h3>
              <button
                type="button"
                onClick={() => setShowBackupsModal(false)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {backups.length === 0 ? (
              <p className="text-slate-500 py-4 text-center">
                لا توجد نسخ احتياطية محفوظة في المجلد المحلي.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {backups.map((bk) => (
                  <div
                    key={bk.name}
                    className="py-2.5 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-mono font-bold text-slate-900">{bk.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {new Date(bk.createdAt).toLocaleString('ar-EG')} · {bk.operationsCount}{' '}
                        عملية
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await ensureGoldApiBridge().storage.restoreBackup(
                          bk.name
                        );
                        if (res.ok && res.state) {
                          exitSafeMode();
                          importFullBackup(res.state);
                          setShowBackupsModal(false);
                        }
                      }}
                      className="px-3 py-1 bg-emerald-600 text-white font-bold rounded-lg cursor-pointer"
                    >
                      استعادة الآن
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
