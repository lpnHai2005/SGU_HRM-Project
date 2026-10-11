import { request, type Attendance } from './attendance';

export interface EmployeeSummaryData {
  employee_name: string;
  working_days: {
    actual_days: number;
    standard_days: number;
    total_hours: number;
  };
  leave_quota: {
    annual_leave: number;
    used_leave: number;
    remaining_leave: number;
  };
  late_arrivals: {
    count: number;
    minutes: number;
  };
  early_departures: {
    count: number;
    minutes: number;
  };
  overtime: {
    shifts_count: number;
    hours: number;
  };
  extra_work?: {
    hours?: number;
  };
  business_trips?: {
    days?: number;
  };
  compensatory_leave?: {
    total?: number;
  };
}

export interface ManagerDashboardStats {
  active_employees: number;
  total_stores: number;
  pending_leaves: number;
  monthly_net_payroll_fund: number;
  monthly_gross_payroll_fund: number;
  total_retail_revenue: number;
  attendance_today: {
    checked_in: number;
    late: number;
  };
  system_status: string;
  current_period: string;
}

export interface LeaveSummaryStats {
  total_requests: number;
  pending_store_approval: number;
  pending_hr_approval: number;
  approved: number;
  rejected: number;
  on_leave_today: number;
}

export interface PayrollUnitItem {
  unit_name: string;
  employee_count: number;
  total_base_salary: number;
  total_overtime: number;
  total_allowances: number;
  total_commissions: number;
  total_bonuses: number;
  total_gross: number;
  total_insurance: number;
  total_penalties: number;
  total_net: number;
}

export interface PayrollFundResponse {
  salary_period: string;
  company_totals: {
    total_headcount: number;
    total_gross_fund: number;
    total_net_fund: number;
    total_insurance_fund: number;
    total_commission_fund: number;
  };
  by_unit: PayrollUnitItem[];
}

export interface AttendanceHistoryRecord extends Attendance {
  notes?: string | null;
}

export async function fetchEmployeeSummary(period: string, token: string): Promise<EmployeeSummaryData> {
  return request<EmployeeSummaryData>(`/attendances/my-summary?period=${period}`, token);
}

export async function fetchEmployeeHistory(period: string, token: string): Promise<AttendanceHistoryRecord[]> {
  return request<AttendanceHistoryRecord[]>(`/attendances/my-history?period=${period}`, token);
}

export async function fetchDashboardStats(period: string, token: string): Promise<ManagerDashboardStats> {
  return request<ManagerDashboardStats>(`/reports/dashboard-stats?period=${period}`, token);
}

export async function fetchLeaveSummaryStats(token: string): Promise<LeaveSummaryStats> {
  return request<LeaveSummaryStats>('/leaves/summary/stats', token);
}

export async function fetchPayrollFundSummary(period: string, token: string): Promise<PayrollFundResponse> {
  return request<PayrollFundResponse>(`/reports/payroll-fund?period=${period}`, token);
}

export function formatVND(amount: number): string {
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

export function generatePeriodOptions(count = 12): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
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

export function calculateAttendanceScore(
  actualDays: number,
  standardDays: number,
  lateCount: number,
  earlyCount: number
): { score: number; grade: string; text: string; color: string } {
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
