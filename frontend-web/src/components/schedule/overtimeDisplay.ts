import type { OvertimeRequestStatus } from '../../types'

type OvertimeStatusTone = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled'

export const OVERTIME_STATUS_CONFIG: Record<OvertimeRequestStatus, {
  label: string
  compactLabel: string
  tone: OvertimeStatusTone
}> = {
  DRAFT: { label: 'Nháp', compactLabel: 'Nháp', tone: 'draft' },
  PENDING_EMPLOYEE_CONFIRMATION: { label: 'Chờ nhân viên xác nhận', compactLabel: 'Chờ NV', tone: 'pending' },
  PENDING_HR: { label: 'Chờ HR duyệt', compactLabel: 'Chờ HR', tone: 'pending' },
  APPROVED: { label: 'Đã duyệt', compactLabel: 'Đã duyệt', tone: 'approved' },
  REJECTED: { label: 'HR từ chối', compactLabel: 'HR từ chối', tone: 'rejected' },
  EMPLOYEE_DECLINED: { label: 'Nhân viên từ chối', compactLabel: 'NV từ chối', tone: 'rejected' },
  CANCELLED: { label: 'Đã hủy', compactLabel: 'Đã hủy', tone: 'cancelled' },
  REVOKED: { label: 'Đã thu hồi', compactLabel: 'Đã thu hồi', tone: 'cancelled' },
  REPLACED: { label: 'Đã được thay thế', compactLabel: 'Đã thay thế', tone: 'cancelled' },
}

export const OVERTIME_REQUEST_STATUS_OPTIONS = Object.entries(OVERTIME_STATUS_CONFIG).map(([value, config]) => ({
  value: value as OvertimeRequestStatus,
  label: config.label,
}))

const workflowStatusLabels: Record<string, { label: string; compactLabel: string; tone: OvertimeStatusTone }> = {
  REVOKE_PENDING: { label: 'Chờ quyết định thu hồi', compactLabel: 'Chờ thu hồi', tone: 'pending' },
  REVOKE_REJECTED: { label: 'Từ chối thu hồi', compactLabel: 'Thu hồi bị từ chối', tone: 'rejected' },
}

export function overtimeStatusLabel(status: OvertimeRequestStatus | string) {
  return OVERTIME_STATUS_CONFIG[status as OvertimeRequestStatus]?.label || workflowStatusLabels[status]?.label || status
}

export function overtimeCompactStatusLabel(status: OvertimeRequestStatus | string) {
  return OVERTIME_STATUS_CONFIG[status as OvertimeRequestStatus]?.compactLabel || workflowStatusLabels[status]?.compactLabel || status
}

export function overtimeStatusClass(status: OvertimeRequestStatus | string) {
  const tone = OVERTIME_STATUS_CONFIG[status as OvertimeRequestStatus]?.tone || workflowStatusLabels[status]?.tone
  switch (tone) {
    case 'draft': return 'is-draft'
    case 'pending': return 'is-pending'
    case 'approved': return 'is-approved'
    case 'rejected': return 'is-rejected'
    case 'cancelled': return 'is-cancelled'
    default: return 'is-pending'
  }
}
