import { request } from './attendance';

export interface LeaveType {
  leave_type_id: number;
  type_code: string;
  type_name: string;
  is_paid: boolean;
  max_days_allowed: number | null;
  requires_attachment: boolean;
}

export interface LeaveBalance {
  employee_id: number;
  employee_name: string;
  annual_leave_total: number;
  annual_leave_used: number;
  annual_leave_remaining: number;
  sick_leave_used: number;
  pending_leave_days: number;
  maternity_leave_used: number;
  unpaid_leave_used: number;
  seniority_bonus_days: number;
}

export interface LeaveRequestItem {
  request_id: number;
  employee_id: number;
  employee_code?: string;
  employee_name?: string;
  store_id?: number;
  store_name?: string;
  department_name?: string;
  position_name?: string;
  leave_type_id: number;
  leave_type_code?: string;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: 'PENDING' | 'STORE_APPROVED' | 'HR_APPROVED' | 'REJECTED' | 'CANCELLED';
  attachment_url?: string | null;
  store_manager_id?: number | null;
  store_manager_name?: string | null;
  store_approved_at?: string | null;
  store_manager_note?: string | null;
  hr_approver_id?: number | null;
  hr_approver_name?: string | null;
  hr_approved_at?: string | null;
  rejection_reason?: string | null;
  rejected_by_id?: number | null;
  rejected_by_name?: string | null;
  rejected_by_role?: string | null;
  rejected_at?: string | null;
  is_store_manager_request?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface LeaveRequestPayload {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  attachment_url?: string | null;
}

export interface LeaveStatusNotification {
  id: string;
  requestId: number;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  oldStatus?: string;
  newStatus: string;
  message: string;
  timestamp: number;
  read: boolean;
}

export const leaveStatusMeta: Record<string, { label: string; color: string; bg: string; step: string }> = {
  PENDING: {
    label: 'Chờ CHT duyệt',
    color: '#d97706',
    bg: '#fef3c7',
    step: 'Cấp 1: Cửa hàng trưởng',
  },
  STORE_APPROVED: {
    label: 'Chờ HR duyệt',
    color: '#2563eb',
    bg: '#dbeafe',
    step: 'Cấp 2: Phòng Nhân sự',
  },
  HR_APPROVED: {
    label: 'Đã phê duyệt',
    color: '#16a34a',
    bg: '#dcfce7',
    step: 'Hoàn tất duyệt',
  },
  REJECTED: {
    label: 'Bị từ chối',
    color: '#dc2626',
    bg: '#fee2e2',
    step: 'Đã từ chối',
  },
  CANCELLED: {
    label: 'Đã hủy',
    color: '#6b7280',
    bg: '#f3f4f6',
    step: 'Đã hủy',
  },
};

export async function fetchLeaveTypes(token: string): Promise<LeaveType[]> {
  return request<LeaveType[]>('/leaves/types', token);
}

export async function fetchLeaveBalance(token: string): Promise<LeaveBalance> {
  return request<LeaveBalance>('/leaves/balances/me', token);
}

export async function fetchMyLeaves(token: string, employeeId?: number): Promise<LeaveRequestItem[]> {
  const query = employeeId ? `?employee_id=${employeeId}` : '';
  return request<LeaveRequestItem[]>(`/leaves${query}`, token);
}

export async function fetchManagerPendingLeaves(token: string): Promise<LeaveRequestItem[]> {
  return request<LeaveRequestItem[]>('/leaves', token);
}

export async function submitLeave(token: string, payload: LeaveRequestPayload): Promise<{ message: string; request_id: number; status: string }> {
  return request<{ message: string; request_id: number; status: string }>('/leaves', token, payload);
}

export async function storeApproveLeave(token: string, requestId: number, note?: string): Promise<{ message: string; status: string }> {
  return request<{ message: string; status: string }>(`/leaves/${requestId}/approve-store`, token, {
    note: note || 'Cửa hàng trưởng đã duyệt sơ bộ trên ứng dụng di động.',
  });
}

export async function hrApproveLeave(token: string, requestId: number, note?: string): Promise<{ message: string; status: string }> {
  return request<{ message: string; status: string }>(`/leaves/${requestId}/approve-hr`, token, {
    note: note || 'Phòng Nhân sự đã duyệt chính thức trên ứng dụng di động.',
  });
}

export async function rejectLeave(token: string, requestId: number, reason: string): Promise<{ message: string; status: string }> {
  return request<{ message: string; status: string }>(`/leaves/${requestId}/reject`, token, {
    rejection_reason: reason,
  });
}

export async function cancelLeave(token: string, requestId: number): Promise<{ message: string; status: string }> {
  return request<{ message: string; status: string }>(`/leaves/${requestId}/cancel`, token, {});
}
