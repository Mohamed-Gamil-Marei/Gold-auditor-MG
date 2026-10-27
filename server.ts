import { evaluateDesktopAccess, resolveListenHost } from './serverConfig';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GeminiService } from './electron/gemini';
import { GoldStorageEngine, migrateState } from './electron/storageEngine';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiter (max 60 requests per minute per IP)
const rateLimitWindowMs = 60 * 1000;
const maxRequestsPerMinute = 60;
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    return true;
  }
  if (entry.count >= maxRequestsPerMinute) {
    return false;
  }
  entry.count += 1;
  return true;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize local file storage engine & Gemini service
  const goldDataRoot = path.join(__dirname, 'GoldAuditData', 'GoldAudit');
  const storageEngine = new GoldStorageEngine(goldDataRoot);
  const geminiService = new GeminiService({
    dataDir: storageEngine.dataDir,
  });

  app.use(express.json({ limit: '15mb' }));

  // حماية /api/desktop/*: fail-closed عند الربط على الشبكة بدون APP_PASSCODE
  const listenHost = resolveListenHost();
  app.use('/api/desktop', (req, res, next) => {
    const decision = evaluateDesktopAccess(
      listenHost,
      process.env.APP_PASSCODE || '',
      String(req.headers['x-app-passcode'] || '')
    );
    if (decision.allowed) {
      next();
      return;
    }
    res.status(decision.status).json({
      ok: false,
      error: decision.error,
      requirePasscode: decision.requirePasscode,
    });
  });

  // --- Desktop Bridge Endpoints (/api/desktop/*) ---
  app.get('/api/desktop/storage/load', (_req, res) => {
    res.json(storageEngine.loadState());
  });

  app.post('/api/desktop/storage/save', (req, res) => {
    res.json(storageEngine.saveState(req.body?.state));
  });

  app.post('/api/desktop/storage/snapshot', (req, res) => {
    res.json(storageEngine.createSnapshotBackup(req.body?.label));
  });

  app.post('/api/desktop/storage/image/save', (req, res) => {
    const { date, dataUrl } = req.body || {};
    res.json(storageEngine.saveImage(date, dataUrl));
  });

  app.get('/api/desktop/storage/image/:date', (req, res) => {
    res.json(storageEngine.loadImage(req.params.date));
  });

  app.delete('/api/desktop/storage/image/:date', (req, res) => {
    res.json(storageEngine.deleteImage(req.params.date));
  });

  app.get('/api/desktop/storage/backups', (_req, res) => {
    res.json(storageEngine.listBackups());
  });

  app.post('/api/desktop/storage/backups/restore', (req, res) => {
    res.json(storageEngine.restoreBackup(req.body?.name));
  });

  app.post('/api/desktop/storage/external-sync', (req, res) => {
    res.json(storageEngine.syncExternalBackup(req.body?.folderPath));
  });

  app.post('/api/desktop/storage/visit-snapshot', (req, res) => {
    const { visitId, visitData } = req.body || {};
    res.json(storageEngine.saveVisitSnapshot(visitId, visitData));
  });

  app.post('/api/desktop/storage/check-images', (req, res) => {
    res.json(storageEngine.checkImagesExist(req.body?.dates || []));
  });

  app.post('/api/desktop/storage/migrate', (req, res) => {
    try {
      const { migrated, wasMigrated } = migrateState(req.body?.state);
      res.json({ ok: true, state: migrated, wasMigrated });
    } catch (err: any) {
      res.json({ ok: false, error: err?.message || 'تعذر ترحيل البيانات' });
    }
  });

  // --- Security / App Lock Endpoints ---
  app.get('/api/desktop/security/status', (_req, res) => {
    res.json(storageEngine.getLockStatus());
  });

  app.post('/api/desktop/security/verify', (req, res) => {
    res.json(storageEngine.verifyPassword(req.body?.password || ''));
  });

  app.post('/api/desktop/security/configure', (req, res) => {
    res.json(storageEngine.configureAppLock(req.body || {}));
  });

  // --- Gemini Key & AI Endpoints ---
  app.get('/api/desktop/ai/key-status', (_req, res) => {
    res.json({ ok: true, ...geminiService.getStatus() });
  });

  app.post('/api/desktop/ai/set-key', (req, res) => {
    res.json(geminiService.setApiKey(req.body?.key || ''));
  });

  app.post('/api/desktop/ai/test-key', async (req, res) => {
    const result = await geminiService.testApiKey(req.body?.customKey, req.body?.modelName);
    res.json(result);
  });

  // Passcode & Rate Limit middleware for OCR / Summarize endpoints
  const checkAiProtection = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'local';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({
        ok: false,
        error: 'تم تجاوز الحد المسموح للطلبات. يرجى الانتظار قليلاً.',
      });
      return;
    }

    const requiredPasscode = (process.env.APP_PASSCODE || '').trim();
    if (requiredPasscode) {
      const provided = String(req.headers['x-app-passcode'] || '').trim();
      if (provided !== requiredPasscode) {
        res.status(401).json({
          ok: false,
          error: 'رمز الحماية (APP_PASSCODE) مطلوب أو غير صحيح.',
          requirePasscode: true,
        });
        return;
      }
    }
    next();
  };

  app.post('/api/ocr-ledger', checkAiProtection, async (req, res) => {
    const result = await geminiService.readLedger(req.body || {});
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json(result.data);
  });

  app.post('/api/desktop/ocr/read-ledger', checkAiProtection, async (req, res) => {
    const result = await geminiService.readLedger(req.body || {});
    res.json(result);
  });

  app.post('/api/summarize-audit', checkAiProtection, async (req, res) => {
    const result = await geminiService.summarizeAudit(req.body || {});
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, summary: result.summary });
  });

  app.post('/api/desktop/ai/summarize', checkAiProtection, async (req, res) => {
    const result = await geminiService.summarizeAudit(req.body || {});
    res.json(result);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, listenHost, () => {
    console.log(`Gold Audit Server running on http://${listenHost}:${PORT}`);
  });
}

startServer();
