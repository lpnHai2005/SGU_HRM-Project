import { request } from './attendance';

export interface OvertimeRequestItem {
  request_id: number;
  employee_id: number;
  employee_code?: string | null;
  employee_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  department_name?: string | null;
  work_date: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  notes?: string | null;
  status:
    | 'DRAFT'
    | 'PENDING_EMPLOYEE_CONFIRMATION'
    | 'PENDING_HR'
    | 'APPROVED'
    | 'REJECTED'
    | 'EMPLOYEE_DECLINED'
    | 'CANCELLED'
    | 'REVOKED'
    | 'REPLACED';
  request_type?: string;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
  employee_confirmed_at?: string | null;
  employee_responded_at?: string | null;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  reviewer_name?: string | null;
  rejection_reason?: string | null;
  cancelled_by?: number | null;
  cancelled_at?: string | null;
  total_hours?: number;
  reconciliation_status?: 'PENDING_RECONCILIATION' | 'NEEDS_REVIEW' | 'VERIFIED' | 'REJECTED' | null;
  verified_microseconds?: number | null;
  verified_hours?: number | null;
  reconciliation_reason?: string | null;
  reconciliation_reviewed_at?: string | null;
}

export interface OvertimeMultiplierInfo {
  rate: string;
  multiplier: number;
  label: string;
  color: string;
  bg: string;
  borderColor: string;
}

export function getOvertimeMultiplier(item: {
  reconciliation_reason?: string | null;
  reason?: string | null;
  work_date: string;
}): OvertimeMultiplierInfo {
  const combined = `${item.reconciliation_reason || ''} ${item.reason || ''}`.toLowerCase();
  if (combined.includes('3.0') || combined.includes('3x') || combined.includes('lễ') || combined.includes('tết')) {
    return {
      rate: '3,0×',
      multiplier: 3.0,
      label: 'Ngày lễ, Tết, ngày nghỉ có hưởng lương (3,0×)',
      color: '#7c3aed',
      bg: 'rgba(124, 58, 237, 0.12)',
      borderColor: 'rgba(124, 58, 237, 0.3)',
    };
  }
  if (combined.includes('2.0') || combined.includes('2x') || combined.includes('chủ nhật') || combined.includes('nghỉ hằng tuần')) {
    return {
      rate: '2,0×',
      multiplier: 2.0,
      label: 'Ngày nghỉ hằng tuần - Chủ nhật (2,0×)',
      color: '#b45309',
      bg: 'rgba(217, 119, 6, 0.12)',
      borderColor: 'rgba(217, 119, 6, 0.3)',
    };
  }
  if (combined.includes('1.5') || combined.includes('1.5x') || combined.includes('ngày thường') || combined.includes('bình thường')) {
    return {
      rate: '1,5×',
      multiplier: 1.5,
      label: 'Ngày làm việc bình thường (1,5×)',
      color: '#1d4ed8',
      bg: 'rgba(37, 99, 235, 0.12)',
      borderColor: 'rgba(37, 99, 235, 0.3)',
    };
  }
  try {
    const d = new Date(item.work_date);
    if (d.getDay() === 0) {
      return {
        rate: '2,0×',
        multiplier: 2.0,
        label: 'Ngày nghỉ hằng tuần - Chủ nhật (2,0×)',
        color: '#b45309',
        bg: 'rgba(217, 119, 6, 0.12)',
        borderColor: 'rgba(217, 119, 6, 0.3)',
      };
    }
  } catch {}
  return {
    rate: '1,5×',
    multiplier: 1.5,
    label: 'Ngày làm việc bình thường (1,5×)',
    color: '#1d4ed8',
    bg: 'rgba(37, 99, 235, 0.12)',
    borderColor: 'rgba(37, 99, 235, 0.3)',
  };
}

export function formatVerifiedHoursDisplay(hours?: number | null, microseconds?: number | null): { minutesText: string; hoursText: string } {
  let val = hours;
  if ((val == null || isNaN(val) || val <= 0) && microseconds && microseconds > 0) {
    val = microseconds / 3_600_000_000.0;
  }
  if (!val || isNaN(val) || val <= 0) {
    return { minutesText: '0 phút', hoursText: '0.00h' };
  }
  const totalMinutes = Math.round(val * 60);
  const minutesText = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60 > 0 ? (totalMinutes % 60) + 'm' : ''}`
    : `${totalMinutes} phút`;
  const hoursText = `${val.toFixed(2)}h`;
  return { minutesText, hoursText };
}

export const reconciliationStatusMeta: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  VERIFIED: {
    label: 'Đã đối soát hợp lệ',
    color: '#16a34a',
    bg: 'rgba(22, 163, 74, 0.12)',
  },
  PENDING_RECONCILIATION: {
    label: 'Chờ đối soát giờ công',
    color: '#d97706',
    bg: 'rgba(217, 119, 6, 0.12)',
  },
  NEEDS_REVIEW: {
    label: 'Cần HR rà soát lại',
    color: '#ea580c',
    bg: 'rgba(234, 88, 12, 0.12)',
  },
  REJECTED: {
    label: 'Từ chối đối soát',
    color: '#dc2626',
    bg: 'rgba(220, 38, 38, 0.12)',
  },
};

export interface OvertimeRequestPayload {
  employee_id?: number;
  store_id?: number;
  work_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  notes?: string | null;
}

export const overtimeStatusMeta: Record<
  string,
  { label: string; color: string; bg: string; step: string }
> = {
  DRAFT: {
    label: 'Bản nháp',
    color: '#6b7280',
    bg: '#f3f4f6',
    step: 'Chưa gửi duyệt',
  },
  PENDING_EMPLOYEE_CONFIRMATION: {
    label: 'Chờ NV xác nhận',
    color: '#d97706',
    bg: '#fef3c7',
    step: 'Cấp 1: Nhân viên xác nhận',
  },
  PENDING_HR: {
    label: 'Chờ HR duyệt',
    color: '#2563eb',
    bg: '#dbeafe',
    step: 'Cấp 2: Quản lý / HR duyệt',
  },
  APPROVED: {
    label: 'Đã phê duyệt',
    color: '#16a34a',
    bg: '#dcfce7',
    step: 'Hoàn tất phê duyệt',
  },
  REJECTED: {
    label: 'Bị từ chối',
    color: '#dc2626',
    bg: '#fee2e2',
    step: 'Đã từ chối',
  },
  EMPLOYEE_DECLINED: {
    label: 'NV từ chối',
    color: '#ea580c',
    bg: '#ffedd5',
    step: 'Nhân viên từ chối',
  },
  CANCELLED: {
    label: 'Đã hủy',
    color: '#6b7280',
    bg: '#f3f4f6',
    step: 'Đã hủy đơn',
  },
  REVOKED: {
    label: 'Đã thu hồi',
    color: '#9333ea',
    bg: '#f3e8ff',
    step: 'Đã thu hồi',
  },
  REPLACED: {
    label: 'Đã thay thế',
    color: '#475569',
    bg: '#f1f5f9',
    step: 'Đã thay thế',
  },
};

export async function fetchMyOvertimeRequests(
  token: string,
  employeeId?: number
): Promise<OvertimeRequestItem[]> {
  const query = employeeId ? `?employee_id=${employeeId}&limit=150` : '?limit=150';
  return request<OvertimeRequestItem[]>(`/overtime-requests${query}`, token);
}

export async function fetchManagerOvertimeRequests(
  token: string,
  storeId?: number
): Promise<OvertimeRequestItem[]> {
  const query = storeId ? `?store_id=${storeId}&limit=150` : '?limit=150';
  return request<OvertimeRequestItem[]>(`/overtime-requests${query}`, token);
}

export async function createOvertimeRequest(
  token: string,
  payload: OvertimeRequestPayload
): Promise<OvertimeRequestItem> {
  // 1. Tạo bản ghi ban đầu
  const created = await request<OvertimeRequestItem>(
    '/overtime-requests',
    token,
    payload
  );
  // 2. Tự động submit để chuyển sang PENDING_HR hoặc PENDING_EMPLOYEE_CONFIRMATION
  try {
    const submitted = await request<OvertimeRequestItem>(
      `/overtime-requests/${created.request_id}/submit`,
      token,
      {}
    );
    return submitted;
  } catch {
    return created;
  }
}

export async function employeeConfirmOvertime(
  token: string,
  requestId: number
): Promise<OvertimeRequestItem> {
  return request<OvertimeRequestItem>(
    `/overtime-requests/${requestId}/employee-confirm`,
    token,
    {}
  );
}

export async function employeeDeclineOvertime(
  token: string,
  requestId: number,
  reason?: string
): Promise<OvertimeRequestItem> {
  return request<OvertimeRequestItem>(
    `/overtime-requests/${requestId}/employee-decline`,
    token,
    reason?.trim() ? { reason: reason.trim() } : {}
  );
}

export async function approveOvertime(
  token: string,
  requestId: number
): Promise<OvertimeRequestItem> {
  return request<OvertimeRequestItem>(
    `/overtime-requests/${requestId}/approve`,
    token,
    {}
  );
}

export async function rejectOvertime(
  token: string,
  requestId: number,
  reason: string
): Promise<OvertimeRequestItem> {
  return request<OvertimeRequestItem>(
    `/overtime-requests/${requestId}/reject`,
    token,
    { reason }
  );
}

export async function cancelOvertime(
  token: string,
  requestId: number,
  reason?: string
): Promise<OvertimeRequestItem> {
  return request<OvertimeRequestItem>(
    `/overtime-requests/${requestId}/cancel`,
    token,
    reason?.trim() ? { reason: reason.trim() } : {}
  );
}

export function calculateOvertimeHours(startsAt: string, endsAt: string): number {
  if (!startsAt || !endsAt) return 0;
  try {
    const start = new Date(startsAt).getTime();
    const end = new Date(endsAt).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return 0;
    const diffMs = end - start;
    return Number((diffMs / (1000 * 60 * 60)).toFixed(2));
  } catch {
    return 0;
  }
}

export interface SelectableEmployee {
  employee_id: number;
  employee_code?: string;
  full_name: string;
  store_id: number;
  store_name?: string;
  department_name?: string;
  position_name?: string;
  employment_status?: string;
}

export async function fetchEmployeesForOvertime(
  token: string,
  storeId?: number
): Promise<SelectableEmployee[]> {
  const query = storeId ? `?store_id=${storeId}&status=ACTIVE` : `?status=ACTIVE`;
  return request<SelectableEmployee[]>(`/employees${query}`, token);
}

