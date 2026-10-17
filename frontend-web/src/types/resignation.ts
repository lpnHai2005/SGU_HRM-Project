// ============================================
// Resignation Type Definitions
// ============================================

export type ResignationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface Resignation {
  resignation_id: number;
  employee_id: number;
  employee_code?: string | null;
  employee_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  position_id?: number | null;
  position_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  contract_id: number;
  contract_number?: string | null;
  contract_type?: string | null;
  contract_start_date?: string | null;
  contract_end_date?: string | null;
  submitted_date: string;
  requested_last_working_date: string;
  reason: string;
  attachment_url?: string | null;
  notes?: string | null;
  status: ResignationStatus;
  rejection_reason?: string | null;
  approved_last_working_date?: string | null;
  created_by: number;
  created_by_name?: string | null;
  approved_by?: number | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  is_hr_or_admin_request?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ResignationStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

export interface ResignationListResponse {
  items: Resignation[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ResignationCreatePayload {
  employee_id: number;
  contract_id: number;
  submitted_date: string;
  requested_last_working_date: string;
  reason: string;
  attachment_url?: string | null;
  notes?: string | null;
}

export interface ResignationApprovePayload {
  approved_last_working_date: string;
  notes?: string | null;
}

export interface ResignationRejectPayload {
  rejection_reason: string;
}

export const RESIGNATION_STATUS_LABELS: Record<ResignationStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

export const RESIGNATION_STATUS_BADGE: Record<ResignationStatus, string> = {
  PENDING: 'badge-status paused',
  APPROVED: 'badge-status running',
  REJECTED: 'badge-status rejected',
  CANCELLED: 'badge-status scheduled',
};

export const RESIGNATION_REASON_PRESETS = [
  'Định hướng nghề nghiệp mới',
  'Lý do gia đình / Thay đổi nơi cư trú',
  'Lý do sức khỏe',
  'Tham gia học tập / Nâng cao trình độ',
  'Thu nhập & Chế độ đãi ngộ',
  'Khoảng cách di chuyển & Thời gian biểu',
  'Lý do cá nhân khác',
];

export type TerminationReasonType =
  | 'EMPLOYEE_RESIGNATION'
  | 'MUTUAL_AGREEMENT'
  | 'EMPLOYER_TERMINATION'
  | 'OTHER';

export const TERMINATION_REASON_TYPE_LABELS: Record<TerminationReasonType, string> = {
  EMPLOYEE_RESIGNATION: 'Thôi việc theo đơn xin thôi việc của nhân viên',
  MUTUAL_AGREEMENT: 'Thỏa thuận chấm dứt hợp đồng giữa hai bên',
  EMPLOYER_TERMINATION: 'Công ty đơn phương chấm dứt hợp đồng',
  OTHER: 'Lý do khác',
};
