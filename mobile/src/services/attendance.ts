export interface Attendance {
  attendance_id: number; work_date: string; shift_name: string | null;
  check_in_time: string | null; check_out_time: string | null;
  actual_work_hours: number; late_minutes: number; early_minutes: number;
  overtime_hours: number; status: string; schedule_status: string;
  store_name?: string | null;
  attendance_context?: { actual: { start_time: string; end_time: string; work_hours: number }; planned?: { shift_id: number; store_id: number } | null } | null;
}
export interface Today extends Attendance {
  can_check_in: boolean; can_check_out: boolean;
  cooldown_seconds_remaining: number; checkout_seconds_remaining: number; shift_id: number | null;
}
export interface Shift { shift_id: number; shift_name: string; start_time: string; end_time: string }
export interface Fence { store_name: string; latitude: number; longitude: number; radius_meters: number }
export class ApiError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}
export const baseUrl = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
export async function request<T>(path: string, token?: string, body?: unknown, form?: FormData): Promise<T> {
  if (!baseUrl) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_URL.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), form ? 45000 : 20000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: body !== undefined || form ? 'POST' : 'GET', signal: controller.signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!form ? { 'Content-Type': 'application/json' } : {}) },
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(typeof data.detail === 'string' ? data.detail : 'Yêu cầu không hợp lệ. Vui lòng thử lại.', res.status, Number(res.headers.get('Retry-After')) || 0);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error(controller.signal.aborted
      ? 'Máy chủ phản hồi quá lâu. Kiểm tra mạng rồi thử lại yêu cầu.'
      : `Không kết nối được máy chủ ${baseUrl}. Điện thoại và máy chủ cần cùng Wi-Fi; máy chủ phải đang chạy. Tải lại trạng thái trước khi thử lại.`);
  } finally { clearTimeout(timer); }
}
export function vietnamPeriod() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date());
}
export function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—';
}
export const scheduleLabels: Record<string, string> = { MATCHED: 'Đúng lịch', UNSCHEDULED: 'Chưa phân ca', SHIFT_MISMATCH: 'Khác lịch phân ca', LEGACY_UNKNOWN: 'Chưa có đối chiếu' };
