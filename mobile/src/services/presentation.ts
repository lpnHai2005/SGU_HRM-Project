import type { Today } from './attendance';
import type { Schedule } from './staff';

export function assignedShift(today: Today | null, schedules: Schedule[], date: string, now = Date.now()) {
  if (today?.can_check_out && today.shift_id) return {
    shift_id: today.shift_id, shift_name: today.shift_name || 'Ca đang làm',
    start_time: today.attendance_context?.actual.start_time,
    end_time: today.attendance_context?.actual.end_time, store_name: today.store_name,
  };
  const candidates = schedules.map(s => {
    const start = Date.parse(`${s.work_date}T${s.start_time}+07:00`);
    let end = Date.parse(`${s.work_date}T${s.end_time}+07:00`);
    if (end <= start) end += 86400000;
    return { s, start, end };
  }).filter(({ s, start, end }) => s.work_date === date || (start <= now && now < end));
  candidates.sort((a, b) => {
    const rank = (v: typeof a) => v.start <= now && now < v.end ? 0 : v.start > now ? 1 : 2;
    return rank(a) - rank(b) || a.start - b.start || a.s.schedule_id - b.s.schedule_id;
  });
  return candidates[0]?.s || null;
}

/** Display only; identifiers and API payloads remain unchanged. */
export function storeLabel(value?: string | null) {
  return (value?.trim() || 'TECHZONE Store').replace(/(?:TechZone\s+)?Flagship(?:\s+Store)?/gi, 'TECHZONE Store');
}
export function shiftProgress(checkIn: string | null | undefined, hours: number | undefined, now: number) {
  if (!checkIn || !hours || hours <= 0) return null;
  const start = Date.parse(checkIn);
  if (!Number.isFinite(start)) return null;
  const elapsed = Math.max(0, (now - start) / 3600000);
  return { percent: Math.min(100, elapsed / hours * 100), elapsed, remaining: Math.max(0, hours - elapsed) };
}
