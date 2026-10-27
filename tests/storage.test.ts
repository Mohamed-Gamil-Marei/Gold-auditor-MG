import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GoldStorageEngine } from '../electron/storageEngine';

const mk = () => new GoldStorageEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'ga-')));

test('loadState: يستعيد الأحدث من النسخ عند فقدان state.json (وليس .bak المتأخر)', () => {
  const e = mk();
  e.saveState({ operations: [{ id: 1 }], daysMap: {} });
  e.saveState({ operations: [{ id: 1 }, { id: 2 }], daysMap: {} });
  e.createSnapshotBackup('manual');
  fs.unlinkSync(e.stateFilePath);
  const r: any = e.loadState();
  assert.equal(r.recoveredFromBackup, true);
  assert.equal(r.state.operations.length, 2);
});

test('createSnapshotBackup: لا يكرر نسخة مطابقة', () => {
  const e = mk();
  e.saveState({ operations: [{ id: 1 }], daysMap: {} });
  const a: any = e.createSnapshotBackup();
  const b: any = e.createSnapshotBackup('on-close');
  assert.equal(a.filename, b.filename);
});

test('verifyPassword: تأخير بعد 5 محاولات خاطئة', async () => {
  const e = mk();
  const cfg = e.configureAppLock({ enabled: true, newPassword: 'good-pass', idleMinutes: 5 });
  assert.equal(cfg.ok, true);
  let last: any;
  for (let i = 0; i < 6; i++) last = e.verifyPassword('bad');
  assert.equal(last.valid, false);
  assert.match(String(last.error), /انتظر/);
  assert.equal((e.verifyPassword('good-pass') as any).valid, false); // ما زال مقفولاً مؤقتاً
});
