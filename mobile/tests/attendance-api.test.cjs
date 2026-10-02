const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/attendance.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client(fetch, url = 'https://test.local/api/v1') {
  const exports = {};
  vm.runInNewContext(source, { exports, process: { env: { EXPO_PUBLIC_API_URL: url } }, fetch, AbortController, setTimeout, clearTimeout, Intl, Date });
  return exports;
}
function response(status, data, retry = null) { return { ok: status < 400, status, headers: { get: () => retry }, json: async () => data }; }
test('authenticated history uses GET and Bearer', async () => {
  const api = client(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/attendances/my-history?period=2026-10');
    assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, 'Bearer secret');
    return response(200, []);
  });
  assert.equal((await api.request('/attendances/my-history?period=2026-10', 'secret')).length, 0);
});
test('check-in sends request id unchanged for retry', async () => {
  const body = { request_id: 'same-id', shift_id: 2 };
  const api = client(async (_, options) => { assert.equal(options.method, 'POST'); assert.equal(options.body, JSON.stringify(body)); return response(201, { attendance_id: 4 }); });
  assert.equal((await api.request('/mobile-attendance/check-in', 'token', body)).attendance_id, 4);
});
test('429 preserves server cooldown', async () => {
  const api = client(async () => response(429, { detail: 'Chờ' }, '59'));
  await assert.rejects(api.request('/mobile-attendance/check-in', 'token', {}), e => e.status === 429 && e.retryAfter === 59);
});
test('401 remains distinguishable for logout', async () => {
  const api = client(async () => response(401, { detail: 'Hết hạn' }));
  await assert.rejects(api.request('/attendances/today-status', 'expired'), e => e.status === 401);
});
test('upload lets fetch set multipart boundary', async () => {
  const form = {};
  const api = client(async (_, options) => { assert.equal(options.body, form); assert.equal(options.headers['Content-Type'], undefined); return response(200, {}); });
  await api.request('/mobile-attendance/photo', 'token', undefined, form);
});
test('network failure is not converted to empty history', async () => {
  const api = client(async () => { throw new Error('network down'); });
  await assert.rejects(api.request('/attendances/my-history'), /Không kết nối/);
});
test('missing API configuration fails without sending request', async () => {
  const api = client(() => assert.fail('must not fetch'), '');
  await assert.rejects(api.request('/auth/login'), /EXPO_PUBLIC_API_URL/);
});
test('structured validation errors produce readable message', async () => {
  const api = client(async () => response(422, { detail: [{ loc: ['latitude'], msg: 'invalid' }] }));
  await assert.rejects(api.request('/mobile-attendance/check-in', 'token', {}), e => e.status === 422 && typeof e.message === 'string');
});
