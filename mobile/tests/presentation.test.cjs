const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const api = {};
test('multiple assignments pick current afternoon instead of oldest schedule ID', () => {
  const rows = [
    {schedule_id:1,shift_id:1,work_date:'2026-10-10',start_time:'08:00:00',end_time:'12:00:00'},
    {schedule_id:2,shift_id:2,work_date:'2026-10-10',start_time:'13:00:00',end_time:'17:00:00'},
  ];
  assert.equal(api.assignedShift(null,rows,'2026-10-10',Date.parse('2026-10-10T14:00:00+07:00')).shift_id,2);
  assert.equal(api.assignedShift(null,rows,'2026-10-10',Date.parse('2026-10-10T12:30:00+07:00')).shift_id,2);
});
test('overnight assignment remains available after midnight and month boundary', () => {
  const rows = [{schedule_id:1,shift_id:4,work_date:'2026-09-30',start_time:'22:00:00',end_time:'06:00:00'}];
  assert.equal(api.assignedShift(null,rows,'2026-10-01',Date.parse('2026-10-01T02:00:00+07:00')).shift_id,4);
  assert.equal(api.assignedShift(null,rows,'2026-10-01',Date.parse('2026-10-01T06:00:00+07:00')),null);
});
test('assignment replaces stale completed attendance and does not invent a schedule', () => {
  const schedules = [{schedule_id:2,shift_id:4,work_date:'2026-10-09',shift_name:'Assigned'}];
  assert.equal(api.assignedShift({can_check_out:false,shift_id:1},schedules,'2026-10-09').shift_id,4);
  assert.equal(api.assignedShift(null,schedules,'2026-10-10'),null);
});
test('open attendance keeps snapshot across midnight or reassignment', () => {
  const open = {can_check_out:true,shift_id:3,shift_name:'Night',attendance_context:{actual:{start_time:'22:00',end_time:'06:00'}}};
  assert.equal(api.assignedShift(open,[],'2026-10-10').shift_id,3);
  assert.equal(api.assignedShift(open,[],'2026-10-10').start_time,'22:00');
});
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/presentation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });
test('store branding preserves branch suffix and handles missing name', () => {
  assert.equal(api.storeLabel('TechZone Flagship Store - Quận 3'), 'TECHZONE Store - Quận 3');
  assert.equal(api.storeLabel(null), 'TECHZONE Store');
  assert.equal(api.storeLabel('TechZone - Quận 6'), 'TechZone - Quận 6');
});
test('progress uses actual elapsed time and clamps at shift boundaries', () => {
  const start = Date.parse('2026-10-09T08:00:00+07:00');
  const time = new Date(start).toISOString();
  assert.equal(api.shiftProgress(time, 8, start + 4 * 3600000).percent, 50);
  assert.equal(api.shiftProgress(time, 8, start - 3600000).percent, 0);
  assert.equal(api.shiftProgress(time, 8, start + 10 * 3600000).percent, 100);
  assert.equal(api.shiftProgress(time, 8, start + 10 * 3600000).remaining, 0);
});
test('unknown shift or invalid check-in does not invent a progress value', () => {
  assert.equal(api.shiftProgress(null, 8, Date.now()), null);
  assert.equal(api.shiftProgress('invalid', 8, Date.now()), null);
  assert.equal(api.shiftProgress('2026-10-09', 0, Date.now()), null);
});
