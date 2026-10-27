import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDesktopAccess, isLoopbackHost, passcodeMatches, resolveListenHost } from '../serverConfig';
import { randomSuffix } from '../src/utils/ids';

test('resolveListenHost: افتراضي محلي، HOST صريح، Cloud Run', () => {
  assert.equal(resolveListenHost({}), '127.0.0.1');
  assert.equal(resolveListenHost({ HOST: '0.0.0.0' }), '0.0.0.0');
  assert.equal(resolveListenHost({ K_SERVICE: 'svc' }), '0.0.0.0');
});

test('isLoopbackHost', () => {
  assert.ok(isLoopbackHost('127.0.0.1'));
  assert.ok(isLoopbackHost('localhost'));
  assert.ok(!isLoopbackHost('0.0.0.0'));
});

test('evaluateDesktopAccess: محلي بدون رمز مسموح', () => {
  assert.equal(evaluateDesktopAccess('127.0.0.1', '', undefined).allowed, true);
});

test('evaluateDesktopAccess: شبكة بدون رمز مرفوض 403', () => {
  const d = evaluateDesktopAccess('0.0.0.0', '', undefined);
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 403);
});

test('evaluateDesktopAccess: رمز صحيح/خاطئ', () => {
  assert.equal(evaluateDesktopAccess('0.0.0.0', 'abc123', 'abc123').allowed, true);
  const bad = evaluateDesktopAccess('0.0.0.0', 'abc123', 'nope');
  assert.equal(bad.allowed, false);
  if (!bad.allowed) {
    assert.equal(bad.status, 401);
    assert.equal(bad.requirePasscode, true);
  }
  assert.ok(passcodeMatches('x', 'x'));
  assert.ok(!passcodeMatches('x', 'y'));
});

test('randomSuffix: الطول والأحرف وعدم التكرار الظاهر', () => {
  const s = randomSuffix(6);
  assert.match(s, /^[0-9a-z]{6}$/);
  const set = new Set(Array.from({ length: 200 }, () => randomSuffix(6)));
  assert.ok(set.size > 190);
});
