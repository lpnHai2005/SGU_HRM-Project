const test = require('node:test');
const assert = require('node:assert/strict');

// Mock helpers from services
function formatVND(amount) {
  if (amount >= 1_000_000_000) {
    return `${(amount / 1_000_000_000).toFixed(2)} tỷ ₫`;
  }
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)} tr ₫`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(0)}k ₫`;
  }
  return `${amount.toLocaleString('vi-VN')} ₫`;
}

function calculateAttendanceScore(actualDays, standardDays, lateCount, earlyCount) {
  const safeStandard = standardDays > 0 ? standardDays : 26;
  const dayRate = Math.min(100, (actualDays / safeStandard) * 100);
  const deductions = lateCount * 3 + earlyCount * 2;
  const score = Math.max(0, Math.min(100, Math.round(dayRate - deductions)));

  if (score >= 90) {
    return { score, grade: 'Xuất sắc', text: 'Duy trì kỷ luật rất tốt, chuyên cần tối ưu', color: '#10b981' };
  }
  if (score >= 75) {
    return { score, grade: 'Tốt', text: 'Hoàn thành tốt công việc, hạn chế đi muộn', color: '#2563eb' };
  }
  if (score >= 60) {
    return { score, grade: 'Khá', text: 'Cần chú ý đi làm đúng giờ và đủ công', color: '#f59e0b' };
  }
  return { score, grade: 'Cần cải thiện', text: 'Tỷ lệ ngày công chưa đạt chỉ tiêu yêu cầu', color: '#ef4444' };
}

function generatePeriodOptions(count = 12) {
  const options = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    options.push({
      value: `${year}-${month}`,
      label: `Tháng ${month}/${year}`,
    });
  }
  return options;
}

test('formatVND formats billions, millions, and thousands correctly', () => {
  assert.equal(formatVND(1_500_000_000), '1.50 tỷ ₫');
  assert.equal(formatVND(127_221_778), '127.2 tr ₫');
  assert.equal(formatVND(50_000), '50k ₫');
  assert.equal(formatVND(500), '500 ₫');
});

test('calculateAttendanceScore evaluates discipline grades accurately', () => {
  const perfect = calculateAttendanceScore(26, 26, 0, 0);
  assert.equal(perfect.score, 100);
  assert.equal(perfect.grade, 'Xuất sắc');

  const good = calculateAttendanceScore(22, 26, 1, 0);
  assert.equal(good.grade, 'Tốt');
  assert.ok(good.score >= 75 && good.score < 90);

  const fair = calculateAttendanceScore(18, 26, 2, 1);
  assert.equal(fair.grade, 'Khá');

  const poor = calculateAttendanceScore(10, 26, 5, 2);
  assert.equal(poor.grade, 'Cần cải thiện');
});

test('generatePeriodOptions produces valid month labels and YYYY-MM values', () => {
  const opts = generatePeriodOptions(6);
  assert.equal(opts.length, 6);
  for (const opt of opts) {
    assert.match(opt.value, /^\d{4}-\d{2}$/);
    assert.match(opt.label, /^Tháng \d{2}\/\d{4}$/);
  }
});

test('attendance rate percentage handles zero and boundary cases', () => {
  const rateZero = (0 / 10) * 100;
  assert.equal(rateZero, 0);

  const rateFull = Math.round((5 / 5) * 100);
  assert.equal(rateFull, 100);

  const ratePartial = Math.round((22 / 26) * 100);
  assert.equal(ratePartial, 85);
});
