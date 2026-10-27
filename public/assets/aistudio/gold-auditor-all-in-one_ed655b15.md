# مراجع الذهب — الباتشات والبرومتات

كل شيء في هذا الملف: البرومتات في الأقسام 1–8، والباتش الكامل (diff لـ14 ملفًا) في آخر الملف.

## طريقة التطبيق

**أ) بالباتش (من مجلد المشروع):** انسخ محتوى قسم «الباتش الكامل» أسفل الملف إلى ملف باسم `fixes.patch` ثم:
```bash
patch -p1 < fixes.patch      # أو: git apply fixes.patch
npm install
npm test                                  # اختبارات جديدة
npm run lint                              # tsc --noEmit
```

**ب) في AI Studio:** الصق كل برومت أدناه كما هو، واحدًا واحدًا، بنفس الترتيب.

**ما تم التحقق منه فعليًا:** الباتش يُطبَّق نظيفًا ويعطي نفس شجرة الملفات. الاختبارات الأربعة نجحت تحت توقيتات القاهرة وUTC ولوس أنجلوس. جُرّب محرك التخزين (الاستعادة، منع التكرار، تأخير القفل، نسخ الصور). **لم يتم** تشغيل Electron نفسه ولا `tsc`، لذلك جرّب الإغلاق (الإصلاح 1) يدويًا.

> **تصحيح لما ذكرته في المراجعة:** مشكلة التواريخ أضيق مما قلت. شاشات `PriceStatementScreen` و`GoldInventoryScreen` و`GoldPricesScreen` و`FilterBar` تستخدم حسابًا صحيحًا (UTC أو ظهرًا). المواضع الخاطئة فعليًا أربعة: مقارنة الفترات في `DaySummaryAndLogScreen`، ونطاق افتراضي في `AuditVisitScreen`، وتاريخ في `fixItEngine`، وفحص `checkAuditLogAnomalies`. أسماء ملفات التصدير تظل بتاريخ UTC (شكلي فقط).

---

## 1) حفظ آخر التعديلات عند إغلاق النافذة
**الملف:** `electron/main.ts`

**البرومت:**
```
في electron/main.ts: عند إغلاق النافذة بزر X لا يُطلب من الواجهة الحفظ النهائي، لأن mainWindow تصبح null قبل before-quit.
المطلوب:
1) أنشئ دالة beginGracefulQuit() تُرسل 'app:flush-before-quit' للواجهة، وتنتظر 'app:flush-complete' (مهلة أمان 3 ثوانٍ)، ثم تنفّذ finalizeOnCloseBackups() وتضبط isQuittingAfterFlush = true ثم app.quit(). امنع التكرار بمتغير isFlushingForQuit.
2) على mainWindow.on('close') : إذا لم يكن isQuittingAfterFlush فنفّذ event.preventDefault() ثم beginGracefulQuit().
3) اجعل app.on('before-quit') يستخدم نفس الدالة.
لا تغيّر preload.ts ولا App.tsx.
```
**اختبار يدوي:** اكتب عملية، اضغط X خلال أقل من نصف ثانية، أعد فتح البرنامج وتأكد أن العملية محفوظة.

## 2) فرق اليوم في التواريخ (توقيت مصر)
**الملفات:** `numerals.ts`، `DaySummaryAndLogScreen.tsx`، `AuditVisitScreen.tsx`، `fixItEngine.ts`، `checkAuditLogAnomalies.ts`

**البرومت:**
```
مشكلة: استخدام new Date("YYYY-MM-DDT00:00:00").toISOString().slice(0,10) يعطي اليوم السابق في توقيت مصر.
1) في src/utils/numerals.ts أضف: toLocalIso(d: Date) تُرجع YYYY-MM-DD بالتوقيت المحلي، و addDaysLocalIso(iso, days) تضيف أيامًا (موجبة/سالبة) وتُرجع ISO محلي (احسب عند الساعة 12:00 لتفادي مشاكل التوقيت الصيفي).
2) في DaySummaryAndLogScreen.tsx استبدل حساب periodAStart/periodAEnd/periodBStart بـ addDaysLocalIso(currentDate, -13 / -7 / -6).
3) في AuditVisitScreen.tsx استبدل النطاق الافتراضي (آخر 7 أيام) بـ addDaysLocalIso(today, -7).
4) في fixItEngine.ts استخدم getTodayIso() بدل new Date().toISOString().slice(0,10).
5) في checkAuditLogAnomalies.ts احسب logDateIso بـ toLocalIso(new Date(log.timestamp)).
لا تغيّر الأماكن التي تحسب بـ T00:00:00Z مع دوال UTC لأنها صحيحة.
```

## 3) فحص «بيع أقل من تكلفة الشراء» لكل عيار
**الملف:** `src/utils/checks/checkSellBelowBuyCost.ts`

**البرومت:**
```
أعد كتابة checkSellBelowBuyCost ليقارن لكل عيار على حدة (karat الافتراضي 21):
- جمّع العمليات حسب العيار ثم التاريخ.
- متوسط سعر جرام البيع يقارَن بمتوسط شراء نفس العيار في نفس اليوم، وإن لم يوجد فبأقرب يوم فيه شراء لنفس العيار (احسب المسافة بالأيام من أرقام الأيام UTC).
- تجاهل العيار 'other'.
- فحص انخفاض الهامش (أكثر من 30%) يُحسب لكل عيار بمتوسطه الخاص.
- اجعل id المشكلة يتضمن العيار (…-k21) وأضف "عيار X" في الرسالة.
- لا تغيّر شكل Issue.
```
**تنبيه:** تغيّر `id` المشكلات، فالمراجعات المحفوظة سابقًا لهذين الفحصين (`issueReviews`) لن ترتبط بالمشكلات الجديدة وستظهر من جديد.

## 4) ربط الخادم المحلي بالجهاز فقط
**الملفان:** `server.ts`، `legacy/server.ts`

**البرومت:**
```
في server.ts و legacy/server.ts غيّر app.listen من '0.0.0.0' إلى '127.0.0.1' لأن مسارات /api/desktop/* بلا مصادقة وتتيح قراءة وكتابة واستعادة كل البيانات.
```
**ملاحظة:** إن كنت تشغّله داخل AI Studio أو سحابة فقد يحتاج المنصة الربط على `0.0.0.0`؛ في هذه الحالة أبقِه كما كان وفعّل `APP_PASSCODE` على مسارات `/api/desktop/*` أيضًا.

## 5) متانة التخزين
**الملف:** `electron/storageEngine.ts`

**البرومت:**
```
في electron/storageEngine.ts:
1) loadState: إذا كان state.json مفقودًا (وليس تالفًا فقط) وفي نفس الوقت يوجد state.json.bak أو نسخ في backups/ فاسترجع منها واعرض recoveredFromBackup. وإن لم يوجد شيء فهو أول تشغيل. إذا كان الملف موجودًا وتالفًا ولا توجد نسخة صالحة فأرجع الخطأ كما هو.
2) formatTimestampForBackup: أضف الثواني لتفادي تطابق اسم نسختين في نفس الدقيقة.
3) createSnapshotBackup: إذا طابق المحتوى أحدث نسخة فلا تنشئ ملفًا جديدًا، باستثناء الوسمين pre-migrate و pre-restore.
4) syncExternalBackup: انسخ مجلد images إلى <المجلد الخارجي>/images دون استبدال الملفات الموجودة.
```
**قيد معروف:** `state.json.bak` يحمل الحفظة السابقة فقط، فالاسترجاع منه قد يفقد آخر تعديل. الأفضل لاحقًا اختيار الأحدث من بين `.bak` ونسخ `backups/`.

## 6) قفل البرنامج: تأخير بعد المحاولات الخاطئة
**الملف:** `electron/storageEngine.ts`

**البرومت:**
```
في verifyPassword أضف عدّاد محاولات فاشلة في الذاكرة: بعد 5 محاولات خاطئة متتالية يُرفض أي تحقق لمدة تبدأ بـ 5 ثوانٍ وتتضاعف مع كل محاولة خاطئة إضافية حتى حد أقصى 300 ثانية، وتُرجع الدالة { ok:false, valid:false, error:'محاولات كثيرة خاطئة. انتظر N ثانية…' }. يُصفَّر العدّاد عند النجاح.
ثم في AppLockOverlay.tsx اعرض رسالة error هذه للمستخدم بدل رسالة "كلمة المرور خاطئة" العامة.
```
**ملاحظة:** الباتش يغطي الجزء الأول فقط؛ البند الثاني (عرض الرسالة في `AppLockOverlay.tsx`) يحتاج البرومت.

## 7) مفتاح Gemini وموديل موحّد
**الملف:** `electron/gemini.ts`

**البرومت:**
```
في electron/gemini.ts:
1) داخل Electron (عندما يُمرَّر safeStorage) إذا كان isEncryptionAvailable() = false فارفض حفظ المفتاح وأرجع خطأ واضحًا بدل حفظه base64. أبقِ ترميز base64 فقط عندما لا يوجد safeStorage أصلًا (وضع التطوير).
2) عرّف ثابتًا مُصدَّرًا DEFAULT_GEMINI_MODEL واستخدمه في testApiKey و readLedger و summarizeAudit بدل النصوص المتفرقة (كان التلخيص يستخدم gemini-2.5-flash والباقي gemini-3.8-flash).
تنبيه: تأكد من اسم الموديل المتاح فعليًا في حسابك من AI Studio قبل اعتماد القيمة.
```
**تنبيه:** الثابت أخذ القيمة `gemini-3.8-flash`، فالتلخيص الذكي قد يتأثر إن لم تمرّر الواجهة `modelName`. لم أستطع التحقق من الاسم، فعدّله إن لزم.

## 8) نظافة المشروع واختبارات
**الملفات:** `.gitignore`، `package.json`، `tests/checks.test.ts`

**البرومت:**
```
1) أضف إلى .gitignore: release/ و dist-electron/ و GoldAuditData/ و server.js.
2) أضف سكربت "test": "tsx --test tests/*.test.ts" وملف tests/checks.test.ts يغطي: عدم الإنذار عند اختلاف العيارات، والإنذار عند بيع 21 أقل من شراء 21، وتجاهل 'other'، و addDaysLocalIso/toLocalIso.
```

---

## برومتات لم أطبّقها في الباتش (تحتاج قرارًا منك)

**أ) تحديث xlsx** (لا أستطيع تحديث `bun.lock` بدون شبكة):
```
حدّث حزمة xlsx من 0.18.5 إلى أحدث إصدار رسمي من SheetJS (يُثبَّت من cdn.sheetjs.com وليس من npm) لأن 0.18.5 بها ثغرات معروفة وتُستخدم لقراءة ملفات المستخدم. حدّث package.json والقفل، وتأكد أن استيراد وتصدير Excel يعملان.
```

**ب) ربط قفل البرنامج بالعملية الرئيسية** (حساس: البيانات تُحمَّل خلف شاشة القفل، وأي منع لـ `storage:load` قبل الفتح سيدخل الوضع الآمن):
```
أريد أن تتحقق العملية الرئيسية (Electron main) من فتح القفل قبل خدمة قنوات storage:* و ai:* عندما يكون القفل مفعّلًا. صمّم التدفق أولًا: الواجهة لا تستدعي hydrateFromStorage إلا بعد security:verifyPassword الناجح، أو تُعرض شاشة القفل قبل أي تحميل. اشرح لي الخطة قبل التعديل، ولا تُدخل التطبيق في الوضع الآمن بسبب رفض التحميل.
```

**ج) تقسيم المتجر الضخم وإزالة `@ts-nocheck`:**
```
قسّم src/store/useAuditStore.ts (2800 سطر) إلى شرائح (operations, days, persons, audit, settings, import) دون تغيير السلوك، وأزل @ts-nocheck من electron/main.ts و preload.ts وأصلح أخطاء الأنواع. أضف اختبارات لكل فحص في src/utils/checks قبل التقسيم.
```

**د) معرّفات آمنة:** استبدل `Date.now()+Math.random()` في إنشاء المعرّفات بـ `crypto.randomUUID()` (مع إبقاء البادئة مثل `op-`).

---

## الباتش الكامل

````diff
diff -ruN a/.gitignore b/.gitignore
--- a/.gitignore	2026-10-27 22:47:32.294471533 +0000
+++ b/.gitignore	2026-10-27 22:47:32.298422169 +0000
@@ -6,3 +6,7 @@
 *.log
 .env*
 !.env.example
+release/
+dist-electron/
+GoldAuditData/
+server.js
diff -ruN a/electron/gemini.ts b/electron/gemini.ts
--- a/electron/gemini.ts	2026-10-27 22:47:32.294681477 +0000
+++ b/electron/gemini.ts	2026-10-27 22:47:32.298660638 +0000
@@ -92,6 +92,9 @@
   required: ['date', 'day_gold_price', 'rows', 'totals_row', 'red_marks'],
 };
 
+/** اسم الموديل الافتراضي الموحد (يُستبدل من الإعدادات إن وُجد). تأكد من اسم الموديل المتاح في حسابك. */
+export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
+
 const MAX_CONCURRENT_REQUESTS = 2;
 const MAX_IMAGE_BASE64_LENGTH = 14_000_000; // ~10MB binary image
 let activeRequests = 0;
@@ -184,8 +187,14 @@
         const encrypted = this.safeStorage.encryptString(trimmed);
         fs.writeFileSync(this.keyFilePath, JSON.stringify({ mode: 'safeStorage', data: encrypted.toString('base64') }), 'utf-8');
         return { ok: true };
+      } else if (this.safeStorage) {
+        // Patch: داخل Electron لا نحفظ المفتاح بشكل شبه مكشوف عند غياب تشفير النظام
+        return {
+          ok: false,
+          error: 'تشفير نظام التشغيل (safeStorage) غير متاح على هذا الجهاز، لذلك لم يتم حفظ المفتاح حمايةً له.',
+        };
       } else {
-        // Fallback obfuscation when OS keyring / safeStorage is unavailable
+        // وضع التطوير (الخادم المحلي بدون safeStorage): ترميز base64 فقط
         const encoded = Buffer.from(trimmed, 'utf-8').toString('base64');
         fs.writeFileSync(this.keyFilePath, JSON.stringify({ mode: 'base64', data: encoded }), 'utf-8');
         return {
@@ -226,7 +235,7 @@
     };
   }
 
-  public async testApiKey(customKey?: string, modelName = 'gemini-3.8-flash'): Promise<{ ok: boolean; message?: string; error?: string }> {
+  public async testApiKey(customKey?: string, modelName = DEFAULT_GEMINI_MODEL): Promise<{ ok: boolean; message?: string; error?: string }> {
     const apiKey = (customKey && customKey.trim()) || this.getStoredApiKey();
     if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
       return { ok: false, error: 'لم يتم إدخال مفتاح Gemini بعد. أدخل المفتاح أولاً.' };
@@ -234,7 +243,7 @@
     try {
       const ai = new GoogleGenAI({ apiKey });
       const response = await ai.models.generateContent({
-        model: modelName || 'gemini-3.8-flash',
+        model: modelName || DEFAULT_GEMINI_MODEL,
         contents: 'أجب بكلمة واحدة فقط: متصل',
       });
       if (response && response.text) {
@@ -264,7 +273,7 @@
       return { ok: false, error: 'حجم الصورة يتجاوز الحد الأقصى المسموح به (10 ميجابايت). يرجى تقليص الصورة.' };
     }
 
-    const modelToUse = params.modelName?.trim() || 'gemini-3.8-flash';
+    const modelToUse = params.modelName?.trim() || DEFAULT_GEMINI_MODEL;
 
     try {
       const data = await withRetryAndConcurrency(async () => {
@@ -331,7 +340,7 @@
       return { ok: false, error: 'البيانات الإحصائية المجمعة مطلوبة.' };
     }
 
-    const modelToUse = params.modelName?.trim() || 'gemini-2.5-flash';
+    const modelToUse = params.modelName?.trim() || DEFAULT_GEMINI_MODEL;
 
     try {
       const summary = await withRetryAndConcurrency(async () => {
diff -ruN a/electron/main.ts b/electron/main.ts
--- a/electron/main.ts	2026-10-27 22:47:32.294718556 +0000
+++ b/electron/main.ts	2026-10-27 22:47:32.298680283 +0000
@@ -10,6 +10,7 @@
 let storageEngine: GoldStorageEngine;
 let geminiService: GeminiService;
 let isQuittingAfterFlush = false;
+let isFlushingForQuit = false;
 
 // Prompt 1.4: Single instance lock
 const gotTheLock = app.requestSingleInstanceLock();
@@ -87,6 +88,13 @@
     mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
   }
 
+  // Patch: اطلب من الواجهة حفظ آخر التعديلات قبل إغلاق النافذة فعلياً (زر X / Alt+F4)
+  mainWindow.on('close', (event) => {
+    if (isQuittingAfterFlush) return;
+    event.preventDefault();
+    beginGracefulQuit();
+  });
+
   mainWindow.on('closed', () => {
     mainWindow = null;
   });
@@ -273,6 +281,38 @@
   }
 }
 
+// Patch: حفظ نهائي من الواجهة ثم نسخة احتياطية ثم الخروج (يُستخدم من close و before-quit)
+function beginGracefulQuit() {
+  if (isFlushingForQuit) return;
+  isFlushingForQuit = true;
+
+  let completed = false;
+  const finishQuit = () => {
+    if (completed) return;
+    completed = true;
+    ipcMain.removeListener('app:flush-complete', finishQuit);
+    finalizeOnCloseBackups();
+    isQuittingAfterFlush = true;
+    app.quit();
+  };
+
+  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
+    finishQuit();
+    return;
+  }
+
+  ipcMain.once('app:flush-complete', finishQuit);
+  try {
+    mainWindow.webContents.send('app:flush-before-quit');
+  } catch {
+    finishQuit();
+    return;
+  }
+
+  // مهلة أمان (3 ثوانٍ) في حال كانت الواجهة مشغولة أو لا تستجيب
+  setTimeout(finishQuit, 3000);
+}
+
 app.whenReady().then(() => {
   const goldDataRoot = path.join(app.getPath('userData'), 'GoldAudit');
   storageEngine = new GoldStorageEngine(goldDataRoot);
@@ -299,36 +339,9 @@
 
 // Requirement 6: Request final flush from renderer via IPC before taking on-close backup
 app.on('before-quit', (event) => {
-  if (isQuittingAfterFlush) {
-    return;
-  }
-
-  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
-    event.preventDefault();
-    let completed = false;
-
-    const finishQuit = () => {
-      if (completed) return;
-      completed = true;
-      finalizeOnCloseBackups();
-      isQuittingAfterFlush = true;
-      app.quit();
-    };
-
-    ipcMain.once('app:flush-complete', finishQuit);
-    try {
-      mainWindow.webContents.send('app:flush-before-quit');
-    } catch {
-      finishQuit();
-      return;
-    }
-
-    // Safety fallback timeout (1.5s) in case renderer is busy/unresponsive
-    setTimeout(finishQuit, 1500);
-  } else {
-    finalizeOnCloseBackups();
-    isQuittingAfterFlush = true;
-  }
+  if (isQuittingAfterFlush) return;
+  event.preventDefault();
+  beginGracefulQuit();
 });
 
 app.on('window-all-closed', () => {
diff -ruN a/electron/storageEngine.ts b/electron/storageEngine.ts
--- a/electron/storageEngine.ts	2026-10-27 22:47:32.294743985 +0000
+++ b/electron/storageEngine.ts	2026-10-27 22:47:32.298709127 +0000
@@ -177,7 +177,8 @@
     const dd = String(d.getDate()).padStart(2, '0');
     const hh = String(d.getHours()).padStart(2, '0');
     const min = String(d.getMinutes()).padStart(2, '0');
-    return `${yyyy}-${mm}-${dd}-${hh}${min}`;
+    const ss = String(d.getSeconds()).padStart(2, '0');
+    return `${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
   }
 
   /**
@@ -237,6 +238,21 @@
       }
       const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
       JSON.parse(raw); // Ensure valid JSON before backing up
+
+      // Patch: لا تنشئ نسخة جديدة إذا كان المحتوى مطابقاً لأحدث نسخة (إلا نسخ ما قبل الترحيل/الاستعادة)
+      const isSafetyLabel = customLabel === 'pre-migrate' || customLabel === 'pre-restore';
+      if (!isSafetyLabel) {
+        const newest = fs
+          .readdirSync(this.backupsDir)
+          .filter((f) => f.startsWith('state-') && f.endsWith('.json'))
+          .map((f) => ({ f, m: fs.statSync(path.join(this.backupsDir, f)).mtimeMs }))
+          .sort((a, b) => b.m - a.m)[0];
+        if (newest) {
+          const prev = fs.readFileSync(path.join(this.backupsDir, newest.f), 'utf-8');
+          if (prev === raw) return { ok: true, filename: newest.f };
+        }
+      }
+
       const stamp = this.formatTimestampForBackup();
       const suffix = customLabel ? `-${customLabel.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
       const filename = `state-${stamp}${suffix}.json`;
@@ -281,8 +297,8 @@
       let recoveredFromBackup = false;
       let recoverySource = '';
 
-      if (!loaded && mainExist) {
-        // state.json exists but is corrupted! Try .bak first
+      if (!loaded) {
+        // state.json corrupted OR missing: try .bak first (Patch: يشمل حالة الملف المفقود)
         loaded = tryParseFile(bakPath);
         if (loaded) {
           recoveredFromBackup = true;
@@ -313,7 +329,7 @@
         if (loaded && recoveredFromBackup) {
           // Restore healthy state.json immediately
           writeJsonAtomically(this.stateFilePath, loaded, false);
-        } else {
+        } else if (mainExist) {
           return {
             ok: false,
             error: 'ملف البيانات الأساسي (state.json) تالف ولم يتم العثور على نسخة احتياطية صالحة.',
@@ -523,6 +539,15 @@
       fs.copyFileSync(this.stateFilePath, latestFile);
       fs.copyFileSync(this.stateFilePath, datedFile);
 
+      // Patch: انسخ صور الدفتر أيضاً (الملفات الموجودة لا تُستبدل)
+      if (fs.existsSync(this.imagesDir)) {
+        fs.cpSync(this.imagesDir, path.join(trimmed, 'images'), {
+          recursive: true,
+          force: false,
+          errorOnExist: false,
+        });
+      }
+
       return { ok: true, targetFile: latestFile, timestamp: Date.now() };
     } catch (err: any) {
       return {
@@ -602,16 +627,39 @@
     };
   }
 
+  // Patch: تأخير تصاعدي بعد 5 محاولات فاشلة متتالية
+  private failedAttempts = 0;
+  private lockedUntil = 0;
+
   public verifyPassword(password: string): { ok: boolean; valid: boolean; error?: string } {
     try {
       const cfg = this.readSecurityFile();
       if (!cfg.enabled || !cfg.passwordHash || !cfg.salt) {
         return { ok: true, valid: true };
       }
+      const now = Date.now();
+      if (now < this.lockedUntil) {
+        const secs = Math.ceil((this.lockedUntil - now) / 1000);
+        return {
+          ok: false,
+          valid: false,
+          error: `محاولات كثيرة خاطئة. انتظر ${secs} ثانية ثم أعد المحاولة.`,
+        };
+      }
       const derived = crypto.scryptSync(String(password || ''), cfg.salt, 64).toString('hex');
       const a = Buffer.from(derived, 'hex');
       const b = Buffer.from(cfg.passwordHash, 'hex');
       const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
+      if (valid) {
+        this.failedAttempts = 0;
+        this.lockedUntil = 0;
+      } else {
+        this.failedAttempts += 1;
+        if (this.failedAttempts >= 5) {
+          const penaltySec = Math.min(300, 5 * 2 ** (this.failedAttempts - 5));
+          this.lockedUntil = Date.now() + penaltySec * 1000;
+        }
+      }
       return { ok: true, valid };
     } catch (err: any) {
       return { ok: false, valid: false, error: err?.message || 'تعذر التحقق من كلمة المرور.' };
diff -ruN a/legacy/server.ts b/legacy/server.ts
--- a/legacy/server.ts	2026-10-27 22:47:32.294846670 +0000
+++ b/legacy/server.ts	2026-10-27 22:47:32.298805225 +0000
@@ -56,5 +56,5 @@
     });
     app.use(vite.middlewares);
   }
-  app.listen(PORT, '0.0.0.0');
+  app.listen(PORT, '127.0.0.1');
 }
diff -ruN a/package.json b/package.json
--- a/package.json	2026-10-27 22:47:32.294888161 +0000
+++ b/package.json	2026-10-27 22:47:32.298826448 +0000
@@ -16,7 +16,8 @@
     "start": "node server.js",
     "preview": "vite preview",
     "clean": "rm -rf dist dist-electron server.js release",
-    "lint": "tsc --noEmit"
+    "lint": "tsc --noEmit",
+    "test": "tsx --test tests/*.test.ts"
   },
   "dependencies": {
     "@fontsource/cairo": "^5.3.0",
diff -ruN a/server.ts b/server.ts
--- a/server.ts	2026-10-27 22:47:32.294993067 +0000
+++ b/server.ts	2026-10-27 22:47:32.298969753 +0000
@@ -194,7 +194,8 @@
     });
   }
 
-  app.listen(PORT, '0.0.0.0', () => {
+  // Patch: الربط على الجهاز المحلي فقط — مسارات /api/desktop/* بلا مصادقة
+  app.listen(PORT, '127.0.0.1', () => {
     console.log(`Gold Audit Server running on http://localhost:${PORT}`);
   });
 }
diff -ruN a/src/components/AuditVisitScreen.tsx b/src/components/AuditVisitScreen.tsx
--- a/src/components/AuditVisitScreen.tsx	2026-10-27 22:47:32.295272796 +0000
+++ b/src/components/AuditVisitScreen.tsx	2026-10-27 22:47:32.299225061 +0000
@@ -17,7 +17,7 @@
 } from 'lucide-react';
 import { useAuditStore } from '../store/useAuditStore';
 import { AuditVisitChecklist, AuditVisitSummarySnapshot } from '../types';
-import { formatNumber, formatWeight, getTodayIso } from '../utils/numerals';
+import { addDaysLocalIso, formatNumber, formatWeight, getTodayIso } from '../utils/numerals';
 import { runAllAuditChecks } from '../utils/checks';
 import { computePersonBalancesSummary } from '../utils/checks/checkPersonBalances';
 import { computeDayGoldInventory } from '../utils/checks/checkGoldInventoryBalance';
@@ -75,9 +75,7 @@
     if (lockedDates.length > 0) {
       return { from: lockedDates[lockedDates.length - 1], to: today };
     }
-    const d = new Date();
-    d.setDate(d.getDate() - 7);
-    return { from: d.toISOString().slice(0, 10), to: today };
+    return { from: addDaysLocalIso(today, -7), to: today };
   }, [auditVisits, daysMap]);
 
   const [newVisitName, setNewVisitName] = useState(
diff -ruN a/src/components/DaySummaryAndLogScreen.tsx b/src/components/DaySummaryAndLogScreen.tsx
--- a/src/components/DaySummaryAndLogScreen.tsx	2026-10-27 22:47:32.295299748 +0000
+++ b/src/components/DaySummaryAndLogScreen.tsx	2026-10-27 22:47:32.299281597 +0000
@@ -36,7 +36,7 @@
   computePersonBalancesSummary,
   PersonComputedBalance,
 } from '../utils/checks/checkPersonBalances';
-import { formatNumber, formatWeight } from '../utils/numerals';
+import { addDaysLocalIso, formatNumber, formatWeight } from '../utils/numerals';
 import { ensureGoldApiBridge } from '../utils/goldApiBridge';
 
 export const DaySummaryAndLogScreen: React.FC = () => {
@@ -68,21 +68,9 @@
   const [pdfFeedback, setPdfFeedback] = useState<string | null>(null);
 
   // Period Comparison state (F8.2)
-  const [periodAStart, setPeriodAStart] = useState(() => {
-    const d = new Date(`${currentDate}T00:00:00`);
-    d.setDate(d.getDate() - 13);
-    return d.toISOString().slice(0, 10);
-  });
-  const [periodAEnd, setPeriodAEnd] = useState(() => {
-    const d = new Date(`${currentDate}T00:00:00`);
-    d.setDate(d.getDate() - 7);
-    return d.toISOString().slice(0, 10);
-  });
-  const [periodBStart, setPeriodBStart] = useState(() => {
-    const d = new Date(`${currentDate}T00:00:00`);
-    d.setDate(d.getDate() - 6);
-    return d.toISOString().slice(0, 10);
-  });
+  const [periodAStart, setPeriodAStart] = useState(() => addDaysLocalIso(currentDate, -13));
+  const [periodAEnd, setPeriodAEnd] = useState(() => addDaysLocalIso(currentDate, -7));
+  const [periodBStart, setPeriodBStart] = useState(() => addDaysLocalIso(currentDate, -6));
   const [periodBEnd, setPeriodBEnd] = useState(() => currentDate);
 
   // Top 10 sort metric (F8.3)
diff -ruN a/src/utils/checks/checkAuditLogAnomalies.ts b/src/utils/checks/checkAuditLogAnomalies.ts
--- a/src/utils/checks/checkAuditLogAnomalies.ts	2026-10-27 22:47:32.296494211 +0000
+++ b/src/utils/checks/checkAuditLogAnomalies.ts	2026-10-27 22:47:32.300405946 +0000
@@ -1,4 +1,5 @@
 import { AuditLogEntry, DayInfo, Issue } from '../../types';
+import { toLocalIso } from '../numerals';
 
 /**
  * Fix B.3:
@@ -38,7 +39,7 @@
       continue;
     }
 
-    const logDateIso = new Date(log.timestamp).toISOString().slice(0, 10);
+    const logDateIso = toLocalIso(new Date(log.timestamp));
     const opTime = new Date(`${log.date}T00:00:00Z`).getTime();
     const editTime = new Date(`${logDateIso}T00:00:00Z`).getTime();
     const diffDays = Math.floor((editTime - opTime) / 86400000);
diff -ruN a/src/utils/checks/checkSellBelowBuyCost.ts b/src/utils/checks/checkSellBelowBuyCost.ts
--- a/src/utils/checks/checkSellBelowBuyCost.ts	2026-10-27 22:47:32.296728123 +0000
+++ b/src/utils/checks/checkSellBelowBuyCost.ts	2026-10-27 22:47:32.300597409 +0000
@@ -3,100 +3,114 @@
 
 /**
  * Prompt 1 Check 4 + Prompt 5.5 Profit Margin Drop:
- * - Average sell price per gram < average buy price per gram for the same day or nearest day (high).
- * - Profit margin drop > 30% compared to usual average margin across days (medium).
+ * - Average sell price per gram < average buy price per gram for the same day/karat or nearest day (high).
+ * - Profit margin drop > 30% compared to usual average margin for the same karat (medium).
+ *
+ * v2 (patch): المقارنة تتم لكل عيار على حدة (18 / 21 / 24) لأن سعر جرام العيارات مختلف أصلاً.
+ * عمليات العيار "other" لا تدخل في المقارنة لأن نقاوتها غير معروفة.
  */
+type Bucket = { buyWeight: number; buyTotal: number; sellWeight: number; sellTotal: number };
+
+const DAY_MS = 86400000;
+
+function dayNumber(iso: string): number {
+  return Math.round(new Date(`${iso}T00:00:00Z`).getTime() / DAY_MS);
+}
+
 export function checkSellBelowBuyCost(operations: Operation[]): Issue[] {
   const issues: Issue[] = [];
 
-  const byDate: Record<
-    string,
-    { buyWeight: number; buyTotal: number; sellWeight: number; sellTotal: number }
-  > = {};
+  // karat -> date -> bucket
+  const byKarat: Record<string, Record<string, Bucket>> = {};
 
   for (const op of operations) {
     if ((op.kind !== 'buy' && op.kind !== 'sell') || op.weightG <= 0 || op.total <= 0) continue;
-    if (!byDate[op.date]) {
-      byDate[op.date] = { buyWeight: 0, buyTotal: 0, sellWeight: 0, sellTotal: 0 };
-    }
+    const karat = op.karat ?? 21;
+    if (karat === 'other') continue;
+    const k = String(karat);
+    byKarat[k] ??= {};
+    byKarat[k][op.date] ??= { buyWeight: 0, buyTotal: 0, sellWeight: 0, sellTotal: 0 };
+    const b = byKarat[k][op.date];
     if (op.kind === 'buy') {
-      byDate[op.date].buyWeight += op.weightG;
-      byDate[op.date].buyTotal += op.total;
+      b.buyWeight += op.weightG;
+      b.buyTotal += op.total;
     } else {
-      byDate[op.date].sellWeight += op.weightG;
-      byDate[op.date].sellTotal += op.total;
+      b.sellWeight += op.weightG;
+      b.sellTotal += op.total;
     }
   }
 
-  const dates = Object.keys(byDate).sort();
-  const dailyMargins: { date: string; margin: number }[] = [];
-
-  for (let i = 0; i < dates.length; i++) {
-    const d = dates[i];
-    const stat = byDate[d];
-    if (stat.sellWeight <= 0) continue;
-
-    const avgSell = stat.sellTotal / stat.sellWeight;
-    let avgBuy = stat.buyWeight > 0 ? stat.buyTotal / stat.buyWeight : 0;
-    let refBuyDate = d;
-
-    // If no buy on the same day, find nearest day with buy
-    if (avgBuy === 0) {
-      let bestDist = Infinity;
-      for (const otherDate of dates) {
-        if (byDate[otherDate].buyWeight > 0) {
-          const dist = Math.abs(new Date(d).getTime() - new Date(otherDate).getTime());
-          if (dist < bestDist) {
-            bestDist = dist;
-            avgBuy = byDate[otherDate].buyTotal / byDate[otherDate].buyWeight;
-            refBuyDate = otherDate;
+  for (const [k, byDate] of Object.entries(byKarat)) {
+    const dates = Object.keys(byDate).sort();
+    const dailyMargins: { date: string; margin: number }[] = [];
+
+    for (const d of dates) {
+      const stat = byDate[d];
+      if (stat.sellWeight <= 0) continue;
+
+      const avgSell = stat.sellTotal / stat.sellWeight;
+      let avgBuy = stat.buyWeight > 0 ? stat.buyTotal / stat.buyWeight : 0;
+      let refBuyDate = d;
+
+      // لا يوجد شراء بنفس اليوم والعيار: أقرب يوم فيه شراء لنفس العيار
+      if (avgBuy === 0) {
+        let bestDist = Infinity;
+        for (const other of dates) {
+          const o = byDate[other];
+          if (o.buyWeight > 0) {
+            const dist = Math.abs(dayNumber(d) - dayNumber(other));
+            if (dist < bestDist) {
+              bestDist = dist;
+              avgBuy = o.buyTotal / o.buyWeight;
+              refBuyDate = other;
+            }
           }
         }
       }
-    }
 
-    if (avgBuy > 0) {
-      const margin = avgSell - avgBuy;
-      dailyMargins.push({ date: d, margin });
-
-      if (avgSell < avgBuy) {
-        const lossPerGram = avgBuy - avgSell;
-        issues.push({
-          id: `sell-below-buy-${d}`,
-          severity: 'high',
-          checkType: 'sell_below_buy',
-          checkTitle: 'بيع أقل من تكلفة الشراء',
-          date: d,
-          kind: 'sell',
-          message: `متوسط سعر بيع الجرام (${formatNumber(avgSell, 0)}) أقل من متوسط تكلفة شراء الجرام (${formatNumber(avgBuy, 0)}${refBuyDate !== d ? ` ليوم ${refBuyDate}` : ''}) بخسارة ${formatNumber(lossPerGram, 0)} ج.م/جرام.`,
-          expected: `>= ${formatNumber(avgBuy, 0)} ج.م`,
-          actual: `${formatNumber(avgSell, 0)} ج.م`,
-          difference: `-${formatNumber(lossPerGram, 0)} ج.م/جرام`,
-        });
+      if (avgBuy > 0) {
+        const margin = avgSell - avgBuy;
+        dailyMargins.push({ date: d, margin });
+
+        if (avgSell < avgBuy) {
+          const lossPerGram = avgBuy - avgSell;
+          issues.push({
+            id: `sell-below-buy-${d}-k${k}`,
+            severity: 'high',
+            checkType: 'sell_below_buy',
+            checkTitle: 'بيع أقل من تكلفة الشراء',
+            date: d,
+            kind: 'sell',
+            message: `عيار ${k}: متوسط سعر بيع الجرام (${formatNumber(avgSell, 0)}) أقل من متوسط تكلفة شراء الجرام (${formatNumber(avgBuy, 0)}${refBuyDate !== d ? ` ليوم ${refBuyDate}` : ''}) بخسارة ${formatNumber(lossPerGram, 0)} ج.م/جرام.`,
+            expected: `>= ${formatNumber(avgBuy, 0)} ج.م`,
+            actual: `${formatNumber(avgSell, 0)} ج.م`,
+            difference: `-${formatNumber(lossPerGram, 0)} ج.م/جرام`,
+          });
+        }
       }
     }
-  }
 
-  // Prompt 5.5: Check if positive profit margin dropped suddenly by > 30% compared to usual positive margin
-  const positiveMargins = dailyMargins.filter((m) => m.margin > 0);
-  if (positiveMargins.length >= 3) {
-    const avgMargin =
-      positiveMargins.reduce((acc, item) => acc + item.margin, 0) / positiveMargins.length;
-    for (const item of positiveMargins) {
-      if (avgMargin > 20 && item.margin < avgMargin * 0.7) {
-        const dropPct = ((avgMargin - item.margin) / avgMargin) * 100;
-        issues.push({
-          id: `margin-drop-${item.date}`,
-          severity: 'medium',
-          checkType: 'profit_margin_drop',
-          checkTitle: 'انخفاض مفاجئ في هامش الربح',
-          date: item.date,
-          kind: 'sell',
-          message: `هامش ربح الجرام اليومي (${formatNumber(item.margin, 0)} ج.م) انخفض بنسبة ${dropPct.toFixed(0)}% عن المعتاد (${formatNumber(avgMargin, 0)} ج.م/جرام).`,
-          expected: `${formatNumber(avgMargin, 0)} ج.م/جرام`,
-          actual: `${formatNumber(item.margin, 0)} ج.م/جرام`,
-          difference: `-${dropPct.toFixed(0)}%`,
-        });
+    // انخفاض هامش الربح المفاجئ (لنفس العيار)
+    const positiveMargins = dailyMargins.filter((m) => m.margin > 0);
+    if (positiveMargins.length >= 3) {
+      const avgMargin =
+        positiveMargins.reduce((acc, item) => acc + item.margin, 0) / positiveMargins.length;
+      for (const item of positiveMargins) {
+        if (avgMargin > 20 && item.margin < avgMargin * 0.7) {
+          const dropPct = ((avgMargin - item.margin) / avgMargin) * 100;
+          issues.push({
+            id: `margin-drop-${item.date}-k${k}`,
+            severity: 'medium',
+            checkType: 'profit_margin_drop',
+            checkTitle: 'انخفاض مفاجئ في هامش الربح',
+            date: item.date,
+            kind: 'sell',
+            message: `عيار ${k}: هامش ربح الجرام اليومي (${formatNumber(item.margin, 0)} ج.م) انخفض بنسبة ${dropPct.toFixed(0)}% عن المعتاد (${formatNumber(avgMargin, 0)} ج.م/جرام).`,
+            expected: `${formatNumber(avgMargin, 0)} ج.م/جرام`,
+            actual: `${formatNumber(item.margin, 0)} ج.م/جرام`,
+            difference: `-${dropPct.toFixed(0)}%`,
+          });
+        }
       }
     }
   }
diff -ruN a/src/utils/fixItEngine.ts b/src/utils/fixItEngine.ts
--- a/src/utils/fixItEngine.ts	2026-10-27 22:47:32.296805731 +0000
+++ b/src/utils/fixItEngine.ts	2026-10-27 22:47:32.300736385 +0000
@@ -9,6 +9,7 @@
   formatNumber,
   formatWeight,
   getEffectiveKaratPrice,
+  getTodayIso,
   normalizeArabicName,
 } from './numerals';
 import { computeDaySafeSummary } from './checks/checkDailySafe';
@@ -367,7 +368,7 @@
           id: `fix-dup-person-${p1.id}-${p2.id}`,
           category: 'duplicate_person',
           safeToAutoApply: false,
-          date: new Date().toISOString().slice(0, 10),
+          date: getTodayIso(),
           isDayLocked: false,
           title: `اشتباه تكرار اسم شخص: "${p1.name}" و "${p2.name}"`,
           description: `الاسمان متطابقان إملائياً بعد توحيد الهمزات والتاء المربوطة. يمكنك دمجهما في حساب واحد مع نقل كافة العمليات.`,
diff -ruN a/src/utils/numerals.ts b/src/utils/numerals.ts
--- a/src/utils/numerals.ts	2026-10-27 22:47:32.296836390 +0000
+++ b/src/utils/numerals.ts	2026-10-27 22:47:32.300767258 +0000
@@ -326,3 +326,18 @@
   const day = String(d.getDate()).padStart(2, '0');
   return `${year}-${month}-${day}`;
 }
+
+/** تاريخ محلي بصيغة YYYY-MM-DD (بدون تحويل إلى UTC الذي يسبب فرق يوم في المناطق الموجبة). */
+export function toLocalIso(d: Date): string {
+  const y = d.getFullYear();
+  const m = String(d.getMonth() + 1).padStart(2, '0');
+  const day = String(d.getDate()).padStart(2, '0');
+  return `${y}-${m}-${day}`;
+}
+
+/** إضافة أيام (موجبة أو سالبة) إلى تاريخ ISO محلي وإرجاع ISO محلي. */
+export function addDaysLocalIso(iso: string, days: number): string {
+  const d = new Date(`${iso}T12:00:00`);
+  d.setDate(d.getDate() + days);
+  return toLocalIso(d);
+}
diff -ruN a/tests/checks.test.ts b/tests/checks.test.ts
--- a/tests/checks.test.ts	1970-01-01 00:00:00.000000000 +0000
+++ b/tests/checks.test.ts	2026-10-27 22:47:32.300893732 +0000
@@ -0,0 +1,28 @@
+import assert from 'node:assert/strict';
+import { test } from 'node:test';
+import { checkSellBelowBuyCost } from '../src/utils/checks/checkSellBelowBuyCost';
+import { addDaysLocalIso, toLocalIso } from '../src/utils/numerals';
+
+const op = (kind: 'buy' | 'sell', karat: any, weightG: number, total: number, date = '2026-10-01') =>
+  ({ id: `${kind}-${karat}-${total}`, kind, karat, weightG, total, date }) as any;
+
+test('لا إنذار عند اختلاف العيارات (24 شراء أغلى من 21 بيع)', () => {
+  const issues = checkSellBelowBuyCost([op('buy', 24, 10, 80000), op('sell', 21, 10, 70000)]);
+  assert.equal(issues.filter((i) => i.checkType === 'sell_below_buy').length, 0);
+});
+
+test('إنذار عند بيع عيار 21 أقل من شراء عيار 21', () => {
+  const issues = checkSellBelowBuyCost([op('buy', 21, 10, 70000), op('sell', 21, 10, 65000)]);
+  assert.equal(issues.filter((i) => i.checkType === 'sell_below_buy').length, 1);
+});
+
+test('العيار other خارج المقارنة', () => {
+  const issues = checkSellBelowBuyCost([op('buy', 'other', 10, 90000), op('sell', 'other', 10, 10000)]);
+  assert.equal(issues.length, 0);
+});
+
+test('addDaysLocalIso لا يتأثر بالتوقيت', () => {
+  assert.equal(addDaysLocalIso('2026-10-28', -13), '2026-10-15');
+  assert.equal(addDaysLocalIso('2026-03-01', -1), '2026-02-28');
+  assert.equal(toLocalIso(new Date(2026, 9, 28, 0, 5)), '2026-10-28');
+});
````
