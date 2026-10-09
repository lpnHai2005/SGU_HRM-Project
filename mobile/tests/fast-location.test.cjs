const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/fast-location.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api, Date, setTimeout, clearTimeout });
const position = (age = 0) => ({ timestamp: Date.now() - age, coords: { latitude: 10, longitude: 106, accuracy: 10 } });
test('fresh accepted cached GPS returns without requesting a new fix', async () => {
  const known = position();
  assert.equal(await api.fastLocation(async () => known, () => assert.fail('new fix not needed'), () => true), known);
});
test('old or future cached GPS is not used', async () => {
  for (const age of [2000, -10000]) {
    const fresh = position();
    assert.equal(await api.fastLocation(async () => position(age), async () => fresh, () => true), fresh);
  }
});
test('unacceptable cached accuracy or geofence requires a fresh fix', async () => {
  const fresh = position();
  assert.equal(await api.fastLocation(async () => position(), async () => fresh, () => false), fresh);
});
test('unsupported cache falls back to actual GPS; actual GPS errors propagate', async () => {
  const fresh = position();
  assert.equal(await api.fastLocation(async () => { throw Error('unsupported'); }, async () => fresh, () => true), fresh);
  await assert.rejects(api.fastLocation(async () => null, async () => { throw Error('GPS off'); }, () => true), /GPS off/);
});
test('unresponsive cache does not block the fresh GPS path', async () => {
  const fresh = position();
  assert.equal(await api.fastLocation(() => new Promise(() => {}), async () => fresh, () => true), fresh);
});
