const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('four manager cards use workforce-only API, finance remains separate', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/dashboard.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: () => ({ request: async (url, token) => { calls.push([url, token]); return { active_employees: 2 }; } }),
  });
  await exports.fetchDashboardKpis('manager-token');
  await exports.fetchDashboardStats('2026-10', 'manager-token');
  assert.deepEqual(calls, [
    ['/reports/dashboard-kpis', 'manager-token'],
    ['/reports/dashboard-stats?period=2026-10', 'manager-token'],
  ]);
});
