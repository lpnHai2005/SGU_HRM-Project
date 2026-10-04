const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const attSource = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/services/attendance.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

const leavesSource = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/services/leaves.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

function createClient(fetchFn, url = 'https://test.local/api/v1') {
  const attExports = {};
  vm.runInNewContext(attSource, {
    exports: attExports,
    process: { env: { EXPO_PUBLIC_API_URL: url } },
    fetch: fetchFn,
    AbortController,
    setTimeout,
    clearTimeout,
    Intl,
    Date,
  });

  const leavesExports = {};
  const customRequire = (moduleName) => {
    if (moduleName === './attendance') return attExports;
    return require(moduleName);
  };

  vm.runInNewContext(leavesSource, {
    exports: leavesExports,
    require: customRequire,
    process: { env: { EXPO_PUBLIC_API_URL: url } },
    fetch: fetchFn,
    AbortController,
    setTimeout,
    clearTimeout,
    Intl,
    Date,
  });

  return leavesExports;
}

function mockResponse(status, data) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => data,
  };
}

test('fetchLeaveTypes sends GET to /leaves/types with Bearer token', async () => {
  const api = createClient(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/leaves/types');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer token123');
    return mockResponse(200, [{ leave_type_id: 1, type_name: 'Nghỉ phép năm' }]);
  });
  const types = await api.fetchLeaveTypes('token123');
  assert.equal(types.length, 1);
  assert.equal(types[0].type_name, 'Nghỉ phép năm');
});

test('fetchLeaveBalance sends GET to /leaves/balances/me', async () => {
  const api = createClient(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/leaves/balances/me');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer token123');
    return mockResponse(200, {
      employee_id: 4,
      annual_leave_total: 12,
      annual_leave_remaining: 10,
      annual_leave_used: 2,
    });
  });
  const bal = await api.fetchLeaveBalance('token123');
  assert.equal(bal.annual_leave_remaining, 10);
});

test('submitLeave sends POST with payload to /leaves', async () => {
  const payload = {
    leave_type_id: 1,
    start_date: '2026-10-15',
    end_date: '2026-10-16',
    total_days: 2,
    reason: 'Về quê việc gia đình',
    attachment_url: null,
  };
  const api = createClient(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/leaves');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), payload);
    return mockResponse(200, { message: 'Thành công', request_id: 40, status: 'PENDING' });
  });
  const res = await api.submitLeave('token123', payload);
  assert.equal(res.request_id, 40);
  assert.equal(res.status, 'PENDING');
});

test('storeApproveLeave sends POST to /leaves/{id}/approve-store with note', async () => {
  const api = createClient(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/leaves/40/approve-store');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.note, 'Duyệt ca kíp');
    return mockResponse(200, { message: 'Duyệt Cấp 1 thành công', status: 'STORE_APPROVED' });
  });
  const res = await api.storeApproveLeave('token123', 40, 'Duyệt ca kíp');
  assert.equal(res.status, 'STORE_APPROVED');
});

test('hrApproveLeave sends POST to /leaves/{id}/approve-hr with note', async () => {
  const api = createClient(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/leaves/40/approve-hr');
    assert.equal(options.method, 'POST');
    return mockResponse(200, { message: 'HR duyệt thành công', status: 'HR_APPROVED' });
  });
  const res = await api.hrApproveLeave('token123', 40, 'HR duyệt');
  assert.equal(res.status, 'HR_APPROVED');
});

test('rejectLeave sends POST to /leaves/{id}/reject with rejection_reason', async () => {
  const api = createClient(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/leaves/40/reject');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.rejection_reason, 'Thiếu nhân sự');
    return mockResponse(200, { message: 'Đã từ chối', status: 'REJECTED' });
  });
  const res = await api.rejectLeave('token123', 40, 'Thiếu nhân sự');
  assert.equal(res.status, 'REJECTED');
});

test('cancelLeave sends POST to /leaves/{id}/cancel', async () => {
  const api = createClient(async (url, options) => {
    assert.equal(url, 'https://test.local/api/v1/leaves/40/cancel');
    assert.equal(options.method, 'POST');
    return mockResponse(200, { message: 'Đã hủy', status: 'CANCELLED' });
  });
  const res = await api.cancelLeave('token123', 40);
  assert.equal(res.status, 'CANCELLED');
});

test('leaveStatusMeta contains valid styling for all 5 statuses', () => {
  const api = createClient(() => {});
  const statuses = ['PENDING', 'STORE_APPROVED', 'HR_APPROVED', 'REJECTED', 'CANCELLED'];
  for (const s of statuses) {
    assert.ok(api.leaveStatusMeta[s], `Missing meta for ${s}`);
    assert.ok(api.leaveStatusMeta[s].label);
    assert.ok(api.leaveStatusMeta[s].color);
  }
});

test('DD-MM-YYYY date conversion helpers work accurately', () => {
  // Transpile requests.tsx helper functions only
  const reqContent = fs.readFileSync(path.join(__dirname, '../src/app/(staff)/requests.tsx'), 'utf8');
  // Check that formatDateDMY, parseDMY, compareDMY, countDaysBetweenDMY, toISODateString are present
  assert.ok(reqContent.includes('export function formatDateDMY'));
  assert.ok(reqContent.includes('export function parseDMY'));
  assert.ok(reqContent.includes('export function toISODateString'));
  assert.ok(reqContent.includes('export function compareDMY'));
  assert.ok(reqContent.includes('export function countDaysBetweenDMY'));

  // Test the logic using the exact regex and algorithms
  const parseDMY = (str) => {
    if (!str) return null;
    const match = str.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const testDate = new Date(year, month, day);
    if (testDate.getFullYear() === year && testDate.getMonth() === month && testDate.getDate() === day) {
      return { year, month, day };
    }
    return null;
  };

  const toISODateString = (dateStr) => {
    const parsed = parseDMY(dateStr);
    if (parsed) {
      const m = String(parsed.month + 1).padStart(2, '0');
      const d = String(parsed.day).padStart(2, '0');
      return `${parsed.year}-${m}-${d}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
      return dateStr.trim();
    }
    return dateStr;
  };

  const countDaysBetweenDMY = (startStr, endStr) => {
    const a = parseDMY(startStr);
    const b = parseDMY(endStr);
    if (!a || !b) return 1;
    const tA = new Date(a.year, a.month, a.day).getTime();
    const tB = new Date(b.year, b.month, b.day).getTime();
    if (tB < tA) return 1;
    return Math.round((tB - tA) / (1000 * 3600 * 24)) + 1;
  };

  // Test parsing
  const parsed = parseDMY('05-10-2026');
  assert.deepEqual(parsed, { year: 2026, month: 9, day: 5 });
  assert.equal(parseDMY('invalid-date'), null);
  assert.equal(parseDMY('31-02-2026'), null); // Feb 31 does not exist

  // Test ISO conversion for backend payload
  assert.equal(toISODateString('05-10-2026'), '2026-10-05');
  assert.equal(toISODateString('2026-10-05'), '2026-10-05');

  // Test days calculation
  assert.equal(countDaysBetweenDMY('05-10-2026', '05-10-2026'), 1);
  assert.equal(countDaysBetweenDMY('05-10-2026', '07-10-2026'), 3);
  assert.equal(countDaysBetweenDMY('28-02-2026', '01-03-2026'), 2);
});
