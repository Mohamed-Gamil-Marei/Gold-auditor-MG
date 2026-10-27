# مراجع الذهب (نسخة Gold-auditor-MG) — الدفعة الثانية: برومتات وباتش كامل

هذه الدفعة مبنية على النسخة التي رفعتها أخيرًا (`Gold-auditor-MG-main`)، أي بعد تطبيق إصلاحات الدفعة الأولى. الباتش في آخر الملف.

## طريقة التطبيق

**أ) بالباتش:** انسخ قسم «الباتش الكامل» أسفل الملف إلى ملف `fixes2.patch` ثم من مجلد المشروع:
```bash
patch -p1 < fixes2.patch        # أو: git apply fixes2.patch
npm install                     # ضروري بعد تغيير xlsx (يحدّث القفل)
npm test                        # 13 اختبارًا
npm run lint
```
**ب) في AI Studio:** الصق البرومتات 1–5 بالترتيب، كلٌّ منها يعمل وحده.

## ما تم التحقق منه
- الباتش يُطبَّق نظيفًا على نسختك ويعطي نفس الشجرة (قارنتها ملفًا ملفًا).
- فحص صياغة (esbuild) لكل الملفات المعدّلة نجح.
- 13 اختبارًا نجحت بتوقيت القاهرة وUTC (4 قديمة + 9 جديدة).
- **لم يتم:** تشغيل `tsc` أو Electron أو `npm install` (الحزم غير متاحة هنا). جرّب بعد التطبيق: `npm run lint` ثم تشغيل البرنامج وإغلاقه.

---

## 1) إصلاح `server.ts`: الربط والحماية (الأهم)

**المشكلة:** الربط صار `0.0.0.0` افتراضيًا، وحماية `/api/desktop` تعمل فقط عند ضبط `APP_PASSCODE` (فارغ افتراضيًا)، فمسارات الحفظ والاستعادة والقفل مفتوحة للشبكة. ولو ضُبط الرمز لا يرسله `goldApiBridge.ts` مع مسارات التخزين فيتعطل التحميل.

**الملفات:** `serverConfig.ts` (جديد)، `server.ts`، `src/utils/goldApiBridge.ts`، `tests/serverConfig.test.ts`

**البرومت:**
```
أنشئ ملف serverConfig.ts في جذر المشروع يصدّر:
- resolveListenHost(env): إن وُجد HOST فاستخدمه، وإن وُجد K_SERVICE (Cloud Run) فـ 0.0.0.0، وإلا 127.0.0.1.
- isLoopbackHost(host).
- passcodeMatches(provided, required): مقارنة بزمن ثابت (SHA-256 ثم crypto.timingSafeEqual).
- evaluateDesktopAccess(host, requiredPasscode, headerValue): إن وُجد APP_PASSCODE يجب أن تطابق الترويسة وإلا 401 مع requirePasscode:true. وإن لم يوجد رمز والربط غير محلي فارفض بـ 403 ورسالة تشرح الحل (اضبط APP_PASSCODE أو شغّل على 127.0.0.1). وإن كان الربط محليًا فمسموح.
في server.ts: استبدل middleware الحالي لـ /api/desktop باستدعاء evaluateDesktopAccess، واربط app.listen على resolveListenHost().
في src/utils/goldApiBridge.ts داخل safeFetchJson: أرسل x-app-passcode من sessionStorage (المفتاح gold_app_passcode) في كل الطلبات، وإذا جاء 401 مع requirePasscode فاسأل المستخدم بـ window.prompt مرة واحدة، خزّن الرمز وأعد الطلب مرة واحدة.
أضف tests/serverConfig.test.ts يغطي الحالات الأربع أعلاه. لا تغيّر مسارات Electron.
```
**ملاحظة:** داخل AI Studio/Cloud Run سيبقى الربط `0.0.0.0` (بسبب `K_SERVICE`)، لكن المسارات ستُرفض ما لم تضبط `APP_PASSCODE` في الأسرار. هذا مقصود.

## 2) استرجاع الأحدث عند فقدان `state.json`

**المشكلة:** `state.json.bak` يحمل الحفظة السابقة فقط، فكان الاسترجاع منه يفقد آخر تعديل رغم وجود نسخة أحدث في `backups/`.

**الملف:** `electron/storageEngine.ts` (`loadState`)

**البرومت:**
```
في loadState عندما يكون state.json مفقودًا أو تالفًا: اجمع كل المرشحين الصالحين (state.json.bak وكل ملفات backups/*.json)، واختر الأحدث حسب الحقل updatedAt داخل الملف (وإن غاب فحسب mtime)، واكتبه كـ state.json بشكل ذري، وأرجع recoveredFromBackup و recoverySource باسم الملف المختار. إن لم يوجد مرشح صالح والملف موجود وتالف فأرجع الخطأ كما كان، وإن لم يكن موجودًا فهو أول تشغيل. أضف tests/storage.test.ts يغطي: الاستعادة من الأحدث، وعدم تكرار النسخة المطابقة، وتأخير القفل بعد 5 محاولات.
```

## 3) معرّفات بلاحقة عشوائية آمنة

**المشكلة:** ~30 معرّفًا تُولَّد بـ `Math.random()`، وهو غير مناسب لمعرّفات تُستخدم في الربط بين السجلات.

**الملفات:** `src/utils/ids.ts` (جديد) + 5 ملفات تستخدمه

**البرومت:**
```
أنشئ src/utils/ids.ts يصدّر randomSuffix(length=4) يعتمد على crypto.getRandomValues ويُرجع أحرف base36. ثم استبدل كل Math.random().toString(36).slice(2, N) في المشروع بـ randomSuffix(N-2) مع الحفاظ على بقية شكل المعرّف تمامًا (البادئة والـ Date.now والترتيب) كي لا تنكسر البيانات المحفوظة. الملفات: src/store/useAuditStore.ts و src/validation/schemas.ts و src/errors/catalog.ts و src/import/pipeline/validateRow.ts و src/components/PhotoUploadScreen.tsx. لا تغيّر أي منطق آخر.
```

## 4) تحديث `xlsx`

**المشكلة:** `xlsx@^0.18.5` من npm به ثغرات معروفة، ويقرأ ملفات المستخدم المستوردة.

**الملف:** `package.json`

**البرومت:**
```
في package.json غيّر xlsx من "^0.18.5" إلى "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz" ثم نفّذ التثبيت لتحديث القفل، وجرّب: استيراد ملف Excel، وتصدير Excel، وتصدير بيان الأسعار.
```
**ملاحظة:** هذا الرابط هو نفسه المستخدم في مشروع MG-Account عندك، فهو إصدار تعرفه. لم أستطع تثبيته هنا لانقطاع الشبكة، فشغّل `npm install` وجرّب الاستيراد والتصدير. وملف `bun.lock` سيتغير بعد التثبيت.

---

## 5) برومتات بدون باتش (قرارات منك)

**أ) تشديد CSP في الإنتاج** (لم أطبّقه لأني لا أستطيع بناء البرنامج هنا، وأي خطأ يعطي نافذة بيضاء):
```
في electron/main.ts و index.html: أزل 'unsafe-inline' من script-src في الإنتاج فقط (أبقِه في وضع التطوير بسبب Vite). ابنِ بـ npm run dist وافتح البرنامج، وافحص وحدة تحكم المطوّر بحثًا عن أي CSP violation. إن ظهر أي انتهاك فأعد القيمة السابقة واذكر لي المصدر.
```

**ب) إزالة `@ts-nocheck`:**
```
أزل // @ts-nocheck من electron/main.ts و electron/preload.ts وأصلح أخطاء الأنواع الناتجة بدون تغيير السلوك، ثم تأكد أن npm run lint ينجح.
```

**ج) تقسيم المتجر الضخم (2800 سطر):**
```
قسّم src/store/useAuditStore.ts إلى شرائح (operations, days, persons, audit, settings, import) دون تغيير السلوك. أضف قبل التقسيم اختبارات لكل فحص في src/utils/checks. لا تغيّر شكل الحالة المحفوظة.
```

**د) تشفير بيانات الدفتر على القرص (اختياري):**
```
أضف خيارًا في الإعدادات لتشفير state.json عند الحفظ باستخدام مفتاح عشوائي مخزّن عبر Electron safeStorage، مع: (1) نسخة احتياطية مشفرة بكلمة مرور يحددها المستخدم لتصدير المفتاح، (2) تحذير صريح قبل التفعيل أن فقدان المفتاح يعني فقدان البيانات، (3) ترحيل آمن يحتفظ بنسخة غير مشفرة مؤقتة حتى يتأكد المستخدم من فتح البيانات. لا تفعّله افتراضيًا.
```

## لماذا لم أقترح ربط القفل بالعملية الرئيسية؟
كنت اقترحته سابقًا، وبعد قراءة التدفق تراجعت عنه: التحميل (`hydrateFromStorage`) يحدث عند فتح التطبيق مستقلًا عن شاشة القفل، فمنع `storage:load` قبل الفتح سيدخل البرنامج في الوضع الآمن. وفائدته محدودة أصلًا: الواجهة معزولة (`sandbox` و`contextIsolation`)، ومن يملك ملفات الجهاز يقرأ `state.json` مباشرة. الحماية الفعلية ضد الوصول للملفات هي التشفير على القرص (البند د).

---

## الباتش الكامل

````diff
diff -ruN a/electron/storageEngine.ts b/electron/storageEngine.ts
--- a/electron/storageEngine.ts	2026-10-27 23:10:33.392682270 +0000
+++ b/electron/storageEngine.ts	2026-10-27 23:10:33.397444556 +0000
@@ -309,32 +309,25 @@
       let recoverySource = '';
 
       if (!loaded) {
-        // state.json is missing or corrupted — try .bak first, then newest backup in backups/
-        loaded = tryParseFile(bakPath);
-        if (loaded) {
+        // state.json مفقود أو تالف: اختر الأحدث بين state.json.bak وكل النسخ في backups/
+        // (الأحدث حسب updatedAt داخل الملف، وإلا حسب وقت التعديل) لأن .bak يحمل الحفظة السابقة فقط.
+        const candidates: { source: string; data: any; stamp: number }[] = [];
+        const addCandidate = (source: string, full: string) => {
+          const data = tryParseFile(full);
+          if (!data) return;
+          const mtime = fs.statSync(full).mtimeMs;
+          const stamp = typeof data.updatedAt === 'number' ? data.updatedAt : mtime;
+          candidates.push({ source, data, stamp });
+        };
+        addCandidate('state.json.bak', bakPath);
+        for (const f of fs.readdirSync(this.backupsDir)) {
+          if (f.endsWith('.json')) addCandidate(f, path.join(this.backupsDir, f));
+        }
+        candidates.sort((x, y) => y.stamp - x.stamp);
+        if (candidates.length > 0) {
+          loaded = candidates[0].data;
           recoveredFromBackup = true;
-          recoverySource = 'state.json.bak';
-        } else {
-          // Try newest valid backup in backups/
-          const backupFiles = fs
-            .readdirSync(this.backupsDir)
-            .filter((f) => f.endsWith('.json'))
-            .map((f) => ({
-              name: f,
-              full: path.join(this.backupsDir, f),
-              mtime: fs.statSync(path.join(this.backupsDir, f)).mtimeMs,
-            }))
-            .sort((a, b) => b.mtime - a.mtime);
-
-          for (const bf of backupFiles) {
-            const candidate = tryParseFile(bf.full);
-            if (candidate) {
-              loaded = candidate;
-              recoveredFromBackup = true;
-              recoverySource = bf.name;
-              break;
-            }
-          }
+          recoverySource = candidates[0].source;
         }
 
         if (loaded && recoveredFromBackup) {
diff -ruN a/package.json b/package.json
--- a/package.json	2026-10-27 23:10:33.392801097 +0000
+++ b/package.json	2026-10-27 23:10:33.397630580 +0000
@@ -35,7 +35,7 @@
     "react-dom": "^19.0.1",
     "recharts": "^3.10.1",
     "vite": "^8.3.0",
-    "xlsx": "^0.18.5",
+    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
     "zod": "^4.6.7",
     "zustand": "^5.0.16"
   },
diff -ruN a/server.ts b/server.ts
--- a/server.ts	2026-10-27 23:10:33.393082224 +0000
+++ b/server.ts	2026-10-27 23:10:33.397922838 +0000
@@ -1,3 +1,4 @@
+import { evaluateDesktopAccess, resolveListenHost } from './serverConfig';
 import dotenv from 'dotenv';
 import express from 'express';
 import path from 'path';
@@ -43,24 +44,24 @@
 
   app.use(express.json({ limit: '15mb' }));
 
-  // Passcode protection middleware for /api/desktop/* when APP_PASSCODE is configured
-  const checkDesktopPasscode = (req: express.Request, res: express.Response, next: express.NextFunction) => {
-    const requiredPasscode = (process.env.APP_PASSCODE || '').trim();
-    if (requiredPasscode) {
-      const provided = String(req.headers['x-app-passcode'] || '').trim();
-      if (provided !== requiredPasscode) {
-        res.status(401).json({
-          ok: false,
-          error: 'رمز الحماية (APP_PASSCODE) مطلوب أو غير صحيح.',
-          requirePasscode: true,
-        });
-        return;
-      }
+  // حماية /api/desktop/*: fail-closed عند الربط على الشبكة بدون APP_PASSCODE
+  const listenHost = resolveListenHost();
+  app.use('/api/desktop', (req, res, next) => {
+    const decision = evaluateDesktopAccess(
+      listenHost,
+      process.env.APP_PASSCODE || '',
+      String(req.headers['x-app-passcode'] || '')
+    );
+    if (decision.allowed) {
+      next();
+      return;
     }
-    next();
-  };
-
-  app.use('/api/desktop', checkDesktopPasscode);
+    res.status(decision.status).json({
+      ok: false,
+      error: decision.error,
+      requirePasscode: decision.requirePasscode,
+    });
+  });
 
   // --- Desktop Bridge Endpoints (/api/desktop/*) ---
   app.get('/api/desktop/storage/load', (_req, res) => {
@@ -213,9 +214,8 @@
     });
   }
 
-  const host = process.env.HOST || '0.0.0.0';
-  app.listen(PORT, host, () => {
-    console.log(`Gold Audit Server running on http://localhost:${PORT}`);
+  app.listen(PORT, listenHost, () => {
+    console.log(`Gold Audit Server running on http://${listenHost}:${PORT}`);
   });
 }
 
diff -ruN a/serverConfig.ts b/serverConfig.ts
--- a/serverConfig.ts	1970-01-01 00:00:00.000000000 +0000
+++ b/serverConfig.ts	2026-10-27 23:10:33.400744876 +0000
@@ -0,0 +1,60 @@
+import crypto from 'node:crypto';
+
+/**
+ * إعدادات الخادم المحلي (وضع المعاينة / الويب) — مفصولة لتكون قابلة للاختبار.
+ * القاعدة: الربط على الجهاز المحلي فقط ما لم يُطلب غير ذلك صراحةً (HOST) أو نكون على Cloud Run.
+ */
+export function resolveListenHost(env: Record<string, string | undefined> = process.env): string {
+  const explicit = String(env.HOST || '').trim();
+  if (explicit) return explicit;
+  if (env.K_SERVICE) return '0.0.0.0'; // Cloud Run / AI Studio preview يتطلب الاستماع على كل الواجهات
+  return '127.0.0.1';
+}
+
+export function isLoopbackHost(host: string): boolean {
+  const h = String(host || '').trim().toLowerCase();
+  return h === '127.0.0.1' || h === '::1' || h === 'localhost' || h.startsWith('127.');
+}
+
+/** مقارنة رمز الحماية بزمن ثابت (عبر SHA-256 لتوحيد الطول). */
+export function passcodeMatches(provided: string, required: string): boolean {
+  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
+  const b = crypto.createHash('sha256').update(String(required || '')).digest();
+  return crypto.timingSafeEqual(a, b);
+}
+
+export type DesktopGuardDecision =
+  | { allowed: true }
+  | { allowed: false; status: number; error: string; requirePasscode?: boolean };
+
+/**
+ * قرار حماية مسارات /api/desktop/*:
+ * - ربط محلي (loopback) بلا رمز: مسموح.
+ * - ربط غير محلي بلا APP_PASSCODE: مرفوض (fail closed) مع رسالة توضح الحل.
+ * - APP_PASSCODE مضبوط: يجب إرسال ترويسة x-app-passcode صحيحة.
+ */
+export function evaluateDesktopAccess(
+  host: string,
+  requiredPasscode: string,
+  providedHeader: string | undefined
+): DesktopGuardDecision {
+  const required = String(requiredPasscode || '').trim();
+  if (required) {
+    if (passcodeMatches(String(providedHeader || '').trim(), required)) return { allowed: true };
+    return {
+      allowed: false,
+      status: 401,
+      error: 'رمز الحماية (APP_PASSCODE) مطلوب أو غير صحيح.',
+      requirePasscode: true,
+    };
+  }
+  if (!isLoopbackHost(host)) {
+    return {
+      allowed: false,
+      status: 403,
+      error:
+        'الخادم مفتوح على الشبكة بدون رمز حماية. اضبط APP_PASSCODE في ملف .env أو شغّله على 127.0.0.1 (احذف المتغير HOST).',
+    };
+  }
+  return { allowed: true };
+}
diff -ruN a/src/components/PhotoUploadScreen.tsx b/src/components/PhotoUploadScreen.tsx
--- a/src/components/PhotoUploadScreen.tsx	2026-10-27 23:10:33.393711764 +0000
+++ b/src/components/PhotoUploadScreen.tsx	2026-10-27 23:10:33.398535452 +0000
@@ -28,6 +28,7 @@
 } from '../utils/numerals';
 import { ensureGoldApiBridge } from '../utils/goldApiBridge';
 import { UniversalImportPanel } from './UniversalImportPanel';
+import { randomSuffix } from '../utils/ids';
 
 pdfjsLib.GlobalWorkerOptions.workerSrc =
   typeof window !== 'undefined'
@@ -417,9 +418,7 @@
                 job.forcedSide || (r.type === 'buy' ? 'buy' : 'sell');
 
               rawReadRows.push({
-                id: `ocr-${Date.now()}-${rawReadRows.length}-${Math.random()
-                  .toString(36)
-                  .slice(2, 5)}`,
+                id: `ocr-${Date.now()}-${rawReadRows.length}-${randomSuffix(3)}`,
                 approved: true,
                 type: rowType,
                 item: r.item || '',
diff -ruN a/src/errors/catalog.ts b/src/errors/catalog.ts
--- a/src/errors/catalog.ts	2026-10-27 23:10:33.394169547 +0000
+++ b/src/errors/catalog.ts	2026-10-27 23:10:33.398988308 +0000
@@ -1,5 +1,6 @@
 import { DiagnosticErrorLog } from '../types';
 import { getTodayIso } from '../utils/numerals';
+import { randomSuffix } from '../utils/ids';
 
 export type ErrorCode =
   | 'E-STORE-001'
@@ -280,7 +281,7 @@
     : undefined;
 
   const entry: DiagnosticErrorLog = {
-    id: `err-${now}-${Math.random().toString(36).slice(2, 6)}`,
+    id: `err-${now}-${randomSuffix(4)}`,
     timestamp: now,
     date: getTodayIso(),
     screen: params.screen || 'عام',
diff -ruN a/src/import/pipeline/validateRow.ts b/src/import/pipeline/validateRow.ts
--- a/src/import/pipeline/validateRow.ts	2026-10-27 23:10:33.394572673 +0000
+++ b/src/import/pipeline/validateRow.ts	2026-10-27 23:10:33.399462525 +0000
@@ -1,6 +1,7 @@
 import { DayInfo } from '../../types';
 import { getEffectiveKaratPrice } from '../../utils/numerals';
 import { NormalizedImportRow } from './normalizeRow';
+import { randomSuffix } from '../../utils/ids';
 
 export type ImportRowHealth = 'ok' | 'warn' | 'error';
 
@@ -92,7 +93,7 @@
 
     return {
       ...row,
-      id: `imp-row-${idx}-${Math.random().toString(36).slice(2, 7)}`,
+      id: `imp-row-${idx}-${randomSuffix(5)}`,
       selected: (health as ImportRowHealth) !== 'error',
       health: health as ImportRowHealth,
       issues,
diff -ruN a/src/store/useAuditStore.ts b/src/store/useAuditStore.ts
--- a/src/store/useAuditStore.ts	2026-10-27 23:10:33.394672739 +0000
+++ b/src/store/useAuditStore.ts	2026-10-27 23:10:33.399649284 +0000
@@ -31,6 +31,7 @@
 import { validateAndQuarantineState } from '../validation/schemas';
 import { reportAppError } from '../errors/catalog';
 import { FixItSuggestion } from '../utils/fixItEngine';
+import { randomSuffix } from '../utils/ids';
 
 export const DEFAULT_EXPENSE_CATEGORIES = [
   'كهرباء',
@@ -861,7 +862,7 @@
         let nextLogs = state.auditLogs;
         if (wasConfirmed && oldPrice > 0 && Math.abs(oldPrice - price) > 0.5 && confirmed) {
           const logEntry: AuditLogEntry = {
-            id: `log-price-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
+            id: `log-price-${Date.now()}-${randomSuffix(4)}`,
             timestamp: Date.now(),
             action: 'price_edit',
             date,
@@ -1195,7 +1196,7 @@
           },
         };
         const logEntry: AuditLogEntry = {
-          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `log-${Date.now()}-${randomSuffix(4)}`,
           timestamp: Date.now(),
           action: lock ? 'lock' : 'unlock',
           date,
@@ -1236,7 +1237,7 @@
 
       const now = Date.now();
       const newOp: Operation = {
-        id: `op-${now}-${Math.random().toString(36).slice(2, 7)}`,
+        id: `op-${now}-${randomSuffix(5)}`,
         date: opInput.date,
         kind: opInput.kind,
         karat:
@@ -1260,7 +1261,7 @@
       set((s) => {
         const wasLocked = Boolean(s.daysMap[newOp.date]?.locked);
         const logEntry: AuditLogEntry = {
-          id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `log-${now}-${randomSuffix(4)}`,
           timestamp: now,
           action: 'add',
           rowId: newOp.id,
@@ -1320,9 +1321,9 @@
       get().createSafetySnapshot(`استيراد جماعي (${rows.length} صف — ${sourceLabel})`);
 
       const now = Date.now();
-      const batchId = `batch-${now}-${Math.random().toString(36).slice(2, 6)}`;
+      const batchId = `batch-${now}-${randomSuffix(4)}`;
       const createdOps: Operation[] = rows.map((r, i) => ({
-        id: `op-batch-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`,
+        id: `op-batch-${now}-${i}-${randomSuffix(4)}`,
         date: r.date,
         kind: r.kind,
         karat: r.karat || (r.kind === 'buy' || r.kind === 'sell' ? 21 : undefined),
@@ -1377,7 +1378,7 @@
 
         const primaryDate = uniqueDates[0] || s.currentDate;
         const batchLog: AuditLogEntry = {
-          id: `log-batch-${now}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `log-batch-${now}-${randomSuffix(4)}`,
           timestamp: now,
           action: 'import_batch',
           date: primaryDate,
@@ -1484,7 +1485,7 @@
 
         if (isMaterialChange) {
           const logEntry: AuditLogEntry = {
-            id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
+            id: `log-${now}-${randomSuffix(4)}`,
             timestamp: now,
             action: 'edit',
             rowId: id,
@@ -1499,7 +1500,7 @@
           nextLogs = [logEntry, ...nextLogs];
         } else if (isReviewOrNoteChange) {
           const reviewLog: AuditLogEntry = {
-            id: `log-rev-${now}-${Math.random().toString(36).slice(2, 6)}`,
+            id: `log-rev-${now}-${randomSuffix(4)}`,
             timestamp: now,
             action: 'review_note',
             rowId: id,
@@ -1536,7 +1537,7 @@
 
       const now = Date.now();
       const trashEntry: DeletedOperationEntry = {
-        id: `trash-${now}-${Math.random().toString(36).slice(2, 6)}`,
+        id: `trash-${now}-${randomSuffix(4)}`,
         operation: existing,
         deletedAt: now,
         reason: reason || 'حذف',
@@ -1547,7 +1548,7 @@
         const nextTrash = [trashEntry, ...s.deletedOperations];
         const wasLocked = Boolean(s.daysMap[existing.date]?.locked);
         const logEntry: AuditLogEntry = {
-          id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `log-${now}-${randomSuffix(4)}`,
           timestamp: now,
           action: 'delete',
           rowId: id,
@@ -1589,7 +1590,7 @@
 
         const now = Date.now();
         const logEntry: AuditLogEntry = {
-          id: `log-undodel-${now}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `log-undodel-${now}-${randomSuffix(4)}`,
           timestamp: now,
           action: 'undo_delete',
           rowId: restored.id,
@@ -1714,7 +1715,7 @@
       set((s) => {
         const nextOps = s.operations.filter((o) => o.id !== s.lastAddedOpId);
         const logEntry: AuditLogEntry = {
-          id: `log-undoadd-${now}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `log-undoadd-${now}-${randomSuffix(4)}`,
           timestamp: now,
           action: 'undo_add',
           rowId: exists.id,
@@ -1753,7 +1754,7 @@
 
     addPerson: (pInput) => {
       const newPerson: Person = {
-        id: `person-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
+        id: `person-${Date.now()}-${randomSuffix(4)}`,
         name: pInput.name.trim(),
         type: pInput.type,
         phone: pInput.phone || '',
@@ -1786,7 +1787,7 @@
     addPersonFollowUp: (personId, followUpInput) => {
       const now = Date.now();
       const newEntry: PersonFollowUp = {
-        id: `fu-${now}-${Math.random().toString(36).slice(2, 6)}`,
+        id: `fu-${now}-${randomSuffix(4)}`,
         date: followUpInput.date || getTodayIso(),
         note: followUpInput.note.trim(),
         promisedDate: followUpInput.promisedDate,
@@ -1894,7 +1895,7 @@
 
     addWorker: (wInput) => {
       const newWorker: Worker = {
-        id: `worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
+        id: `worker-${Date.now()}-${randomSuffix(4)}`,
         name: wInput.name.trim(),
         monthlySalary: wInput.monthlySalary,
         dueDay: wInput.dueDay || 30,
@@ -2504,7 +2505,7 @@
       const s = get();
       const now = Date.now();
       const snap: SafetySnapshot = {
-        id: `snap-${now}-${Math.random().toString(36).slice(2, 6)}`,
+        id: `snap-${now}-${randomSuffix(4)}`,
         label,
         createdAt: now,
         expiresAt: now + 10 * 60 * 1000, // 10 minutes
@@ -2630,7 +2631,7 @@
         if (ok) {
           set((state) => {
             const logEntry: AuditLogEntry = {
-              id: `log-fixit-${now}-${Math.random().toString(36).slice(2, 6)}`,
+              id: `log-fixit-${now}-${randomSuffix(4)}`,
               timestamp: now,
               action: 'fix_it',
               rowId: suggestion.operationId,
@@ -2669,7 +2670,7 @@
       const now = Date.now();
       set((s) => {
         const logEntry: AuditLogEntry = {
-          id: `log-${isPrint ? 'print' : 'export'}-${now}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `log-${isPrint ? 'print' : 'export'}-${now}-${randomSuffix(4)}`,
           timestamp: now,
           action: isPrint ? 'print' : 'export',
           date: s.currentDate,
@@ -2691,7 +2692,7 @@
       const now = Date.now();
       set((s) => {
         const newPreset: SavedFilterPreset = {
-          id: `fpreset-${now}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `fpreset-${now}-${randomSuffix(4)}`,
           name: trimmed,
           screenId,
           filter: JSON.parse(JSON.stringify(filter)),
@@ -2718,7 +2719,7 @@
       const now = Date.now();
       const newTemplate: ImportMappingTemplate = {
         ...templateInput,
-        id: `imptpl-${now}-${Math.random().toString(36).slice(2, 6)}`,
+        id: `imptpl-${now}-${randomSuffix(4)}`,
         createdAt: now,
       };
       set((s) => {
diff -ruN a/src/utils/goldApiBridge.ts b/src/utils/goldApiBridge.ts
--- a/src/utils/goldApiBridge.ts	2026-10-27 23:10:33.395485166 +0000
+++ b/src/utils/goldApiBridge.ts	2026-10-27 23:10:33.400307850 +0000
@@ -102,15 +102,43 @@
 const IDB_FALLBACK_STATE_KEY = 'gold_audit_v3_state';
 const IDB_FALLBACK_IMAGES_KEY = 'gold_audit_v3_images';
 
-async function safeFetchJson(url: string, options?: RequestInit): Promise<any> {
+const PASSCODE_STORAGE_KEY = 'gold_app_passcode';
+
+function getStoredPasscode(): string {
+  try {
+    return sessionStorage.getItem(PASSCODE_STORAGE_KEY) || '';
+  } catch {
+    return '';
+  }
+}
+
+async function safeFetchJson(url: string, options?: RequestInit, retried = false): Promise<any> {
   try {
+    const stored = getStoredPasscode();
     const res = await fetch(url, {
       ...options,
       headers: {
         'Content-Type': 'application/json',
+        ...(stored ? { 'x-app-passcode': stored } : {}),
         ...(options?.headers || {}),
       },
     });
+
+    // الخادم يطلب APP_PASSCODE: اسأل المستخدم مرة واحدة ثم أعد المحاولة
+    if (res.status === 401 && !retried && typeof window !== 'undefined' && typeof window.prompt === 'function') {
+      const body = await res.clone().json().catch(() => null);
+      if (body?.requirePasscode) {
+        const entered = window.prompt('أدخل رمز الحماية (APP_PASSCODE):');
+        if (entered && entered.trim()) {
+          try {
+            sessionStorage.setItem(PASSCODE_STORAGE_KEY, entered.trim());
+          } catch {
+            // ignore
+          }
+          return safeFetchJson(url, options, true);
+        }
+      }
+    }
     return await res.json();
   } catch (err: any) {
     return { ok: false, error: err?.message || 'تعذر الاتصال بالعملية الرئيسية' };
diff -ruN a/src/utils/ids.ts b/src/utils/ids.ts
--- a/src/utils/ids.ts	1970-01-01 00:00:00.000000000 +0000
+++ b/src/utils/ids.ts	2026-10-27 23:10:33.400466378 +0000
@@ -0,0 +1,12 @@
+/**
+ * لاحقة عشوائية آمنة (base36) للمعرّفات، بدل Math.random().
+ * تحافظ على نفس شكل المعرّفات القديمة: `${prefix}-${Date.now()}-${randomSuffix(4)}`.
+ */
+export function randomSuffix(length = 4): string {
+  const n = Math.max(1, Math.floor(length));
+  const bytes = new Uint8Array(n);
+  globalThis.crypto.getRandomValues(bytes);
+  let out = '';
+  for (let i = 0; i < n; i++) out += (bytes[i] % 36).toString(36);
+  return out;
+}
diff -ruN a/src/validation/schemas.ts b/src/validation/schemas.ts
--- a/src/validation/schemas.ts	2026-10-27 23:10:33.395629400 +0000
+++ b/src/validation/schemas.ts	2026-10-27 23:10:33.400644579 +0000
@@ -8,6 +8,7 @@
   QuarantinedRecord,
   Worker,
 } from '../types';
+import { randomSuffix } from '../utils/ids';
 
 const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
 
@@ -166,7 +167,7 @@
       } else {
         const firstIssue = parsed.error.issues[0];
         quarantined.push({
-          id: `quar-op-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
+          id: `quar-op-${now}-${idx}-${randomSuffix(4)}`,
           entityType: 'operation',
           rawData: rawOp,
           reason: firstIssue
diff -ruN a/tests/serverConfig.test.ts b/tests/serverConfig.test.ts
--- a/tests/serverConfig.test.ts	1970-01-01 00:00:00.000000000 +0000
+++ b/tests/serverConfig.test.ts	2026-10-27 23:10:33.400701416 +0000
@@ -0,0 +1,45 @@
+import assert from 'node:assert/strict';
+import test from 'node:test';
+import { evaluateDesktopAccess, isLoopbackHost, passcodeMatches, resolveListenHost } from '../serverConfig';
+import { randomSuffix } from '../src/utils/ids';
+
+test('resolveListenHost: افتراضي محلي، HOST صريح، Cloud Run', () => {
+  assert.equal(resolveListenHost({}), '127.0.0.1');
+  assert.equal(resolveListenHost({ HOST: '0.0.0.0' }), '0.0.0.0');
+  assert.equal(resolveListenHost({ K_SERVICE: 'svc' }), '0.0.0.0');
+});
+
+test('isLoopbackHost', () => {
+  assert.ok(isLoopbackHost('127.0.0.1'));
+  assert.ok(isLoopbackHost('localhost'));
+  assert.ok(!isLoopbackHost('0.0.0.0'));
+});
+
+test('evaluateDesktopAccess: محلي بدون رمز مسموح', () => {
+  assert.equal(evaluateDesktopAccess('127.0.0.1', '', undefined).allowed, true);
+});
+
+test('evaluateDesktopAccess: شبكة بدون رمز مرفوض 403', () => {
+  const d = evaluateDesktopAccess('0.0.0.0', '', undefined);
+  assert.equal(d.allowed, false);
+  if (!d.allowed) assert.equal(d.status, 403);
+});
+
+test('evaluateDesktopAccess: رمز صحيح/خاطئ', () => {
+  assert.equal(evaluateDesktopAccess('0.0.0.0', 'abc123', 'abc123').allowed, true);
+  const bad = evaluateDesktopAccess('0.0.0.0', 'abc123', 'nope');
+  assert.equal(bad.allowed, false);
+  if (!bad.allowed) {
+    assert.equal(bad.status, 401);
+    assert.equal(bad.requirePasscode, true);
+  }
+  assert.ok(passcodeMatches('x', 'x'));
+  assert.ok(!passcodeMatches('x', 'y'));
+});
+
+test('randomSuffix: الطول والأحرف وعدم التكرار الظاهر', () => {
+  const s = randomSuffix(6);
+  assert.match(s, /^[0-9a-z]{6}$/);
+  const set = new Set(Array.from({ length: 200 }, () => randomSuffix(6)));
+  assert.ok(set.size > 190);
+});
diff -ruN a/tests/storage.test.ts b/tests/storage.test.ts
--- a/tests/storage.test.ts	1970-01-01 00:00:00.000000000 +0000
+++ b/tests/storage.test.ts	2026-10-27 23:10:33.400713223 +0000
@@ -0,0 +1,38 @@
+import assert from 'node:assert/strict';
+import fs from 'node:fs';
+import os from 'node:os';
+import path from 'node:path';
+import test from 'node:test';
+import { GoldStorageEngine } from '../electron/storageEngine';
+
+const mk = () => new GoldStorageEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'ga-')));
+
+test('loadState: يستعيد الأحدث من النسخ عند فقدان state.json (وليس .bak المتأخر)', () => {
+  const e = mk();
+  e.saveState({ operations: [{ id: 1 }], daysMap: {} });
+  e.saveState({ operations: [{ id: 1 }, { id: 2 }], daysMap: {} });
+  e.createSnapshotBackup('manual');
+  fs.unlinkSync(e.stateFilePath);
+  const r: any = e.loadState();
+  assert.equal(r.recoveredFromBackup, true);
+  assert.equal(r.state.operations.length, 2);
+});
+
+test('createSnapshotBackup: لا يكرر نسخة مطابقة', () => {
+  const e = mk();
+  e.saveState({ operations: [{ id: 1 }], daysMap: {} });
+  const a: any = e.createSnapshotBackup();
+  const b: any = e.createSnapshotBackup('on-close');
+  assert.equal(a.filename, b.filename);
+});
+
+test('verifyPassword: تأخير بعد 5 محاولات خاطئة', async () => {
+  const e = mk();
+  const cfg = e.configureAppLock({ enabled: true, newPassword: 'good-pass', idleMinutes: 5 });
+  assert.equal(cfg.ok, true);
+  let last: any;
+  for (let i = 0; i < 6; i++) last = e.verifyPassword('bad');
+  assert.equal(last.valid, false);
+  assert.match(String(last.error), /انتظر/);
+  assert.equal((e.verifyPassword('good-pass') as any).valid, false); // ما زال مقفولاً مؤقتاً
+});
````
