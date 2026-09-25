// ============================================
// TypeScript Type Definitions for HRM System
// ============================================

export type UserRole = 'ADMIN' | 'HR_MANAGER' | 'STORE_MANAGER' | 'EMPLOYEE';

export interface UserProfile {
  user_id: number;
  username: string;
  email: string;
  phone?: string | null;
  is_active: boolean;
  roles: string[];
  permissions: string[];
  employee_id?: number | null;
  employee_code?: string | null;
  full_name?: string | null;
  department_name?: string | null;
  position_name?: string | null;
  store_name?: string | null;
  store_id?: number | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  username: string;
  full_name?: string | null;
  roles: string[];
  permissions: string[];
  employee_id?: number | null;
  store_id?: number | null;
  store_name?: string | null;
}

export interface TestAccountResponse {
  username: string;
  role: string;
  name: string;
  desc: string;
}

export interface Employee {
  employee_id: number;
  employee_code?: string | null;
  first_name: string;
  last_name: string;
  full_name?: string | null;
  gender?: string | null;
  dob?: string | null;
  identity_card?: string | null;
  phone?: string | null;
  personal_email?: string | null;
  company_email?: string | null;
  permanent_address?: string | null;
  current_address?: string | null;
  store_id?: number | null;
  department_id?: number | null;
  position_id?: number | null;
  education_level_id?: number | null;
  join_date?: string | null;
  employment_status?: string | null;
  bank_account_number?: string | null;
  bank_name?: string | null;
  department_name?: string | null;
  position_name?: string | null;
  store_name?: string | null;
  education_level_name?: string | null;
  created_at?: string | null;
  basic_salary?: number;
}

export interface EmployeeCreate {
  employee_code?: string;
  first_name: string;
  last_name: string;
  gender?: string;
  dob?: string;
  identity_card?: string;
  phone?: string;
  personal_email?: string;
  company_email?: string;
  permanent_address?: string;
  current_address?: string;
  store_id?: number;
  department_id?: number;
  position_id?: number;
  education_level_id?: number;
  join_date?: string;
  employment_status?: string;
  bank_account_number?: string;
  bank_name?: string;
  basic_salary?: number;
}

export interface EmployeeUpdate {
  first_name?: string;
  last_name?: string;
  phone?: string;
  personal_email?: string;
  current_address?: string;
  store_id?: number;
  department_id?: number;
  position_id?: number;
  employment_status?: string;
}

export interface PromotionCreate {
  employee_id: number;
  new_position_id: number;
  new_store_id?: number;
  decision_number?: string;
  reason?: string;
}

export interface Contract {
  contract_id: number;
  contract_number: string;
  employee_id: number;
  employee_name?: string;
  contract_type: string;
  start_date: string;
  end_date?: string;
  basic_salary?: number;
  insurance_salary?: number;
  salary_percentage?: number;
  working_hours_per_week?: number;
  signed_date?: string;
  status: string;
  created_at?: string;
}

export interface ContractCreate {
  employee_id: number;
  contract_number?: string;
  contract_type: string;
  start_date: string;
  end_date?: string;
  basic_salary?: number;
  insurance_salary?: number;
  salary_percentage?: number;
  working_hours_per_week?: number;
  signed_date?: string;
}

export interface Lookups {
  departments: Array<{
    department_id: number;
    department_code: string;
    department_name: string;
  }>;
  stores: Array<{
    store_id: number;
    store_code: string;
    store_name: string;
    district?: string;
    city?: string;
  }>;
  positions: Array<{
    position_id: number;
    position_code: string;
    position_name: string;
    position_allowance?: number;
  }>;
  education_levels: Array<{
    education_level_id: number;
    level_code: string;
    level_name: string;
  }>;
  work_shifts: Array<{
    shift_id: number;
    shift_code: string;
    shift_name: string;
    start_time: string;
    end_time: string;
    work_hours: number;
  }>;
}

export interface Attendance {
  attendance_id: number;
  employee_id: number;
  employee_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  shift_id?: number | null;
  shift_name?: string | null;
  work_date: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  late_minutes?: number;
  early_minutes?: number;
  overtime_hours?: number;
  actual_work_hours?: number;
  status: string;
  notes?: string | null;
}

export interface CheckInRequest {
  employee_id?: number;
  shift_id?: number;
  notes?: string;
}

export interface CheckOutRequest {
  attendance_id: number;
  notes?: string;
}

export interface CheckInResponse {
  message: string;
  attendance_id: number;
  time: string;
  status: string;
  late_minutes: number;
}

export interface ShiftSchedule {
  schedule_id: number;
  employee_id: number;
  employee_name?: string;
  store_id: number;
  store_name?: string;
  shift_id: number;
  shift_name?: string;
  work_date: string;
  notes?: string;
}

export interface ShiftScheduleCreate {
  employee_id: number;
  store_id: number;
  shift_id: number;
  work_date: string;
  notes?: string;
}

export interface LeaveType {
  leave_type_id: number;
  type_code: string;
  type_name: string;
  is_paid: boolean;
  max_days_allowed: number;
  requires_attachment?: boolean;
}

export interface LeaveBalance {
  employee_id: number;
  employee_name?: string | null;
  annual_leave_total: number;
  annual_leave_used: number;
  annual_leave_remaining: number;
  sick_leave_used: number;
  pending_leave_days?: number;
  maternity_leave_used?: number;
  unpaid_leave_used?: number;
  seniority_bonus_days?: number;
}

export interface LeaveRequest {
  request_id: number;
  employee_id: number;
  employee_code?: string | null;
  employee_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  department_name?: string | null;
  position_name?: string | null;
  leave_type_id: number;
  leave_type_name?: string | null;
  leave_type_code?: string | null;
  start_date: string;
  end_date: string;
  total_days?: number;
  reason?: string | null;
  status: string;
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
  is_store_manager_request?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LeaveRequestCreate {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  attachment_url?: string;
}

export interface LeaveApproveRequest {
  note?: string;
}

export interface LeaveRejectRequest {
  rejection_reason: string;
}

export interface PayrollDetail {
  detail_id: number;
  item_code: string;
  item_name: string;
  item_type: string;
  calculation_formula?: string | null;
  amount?: number;
  notes?: string | null;
}

export interface Payroll {
  payroll_id: number;
  employee_id: number;
  employee_code?: string | null;
  employee_name?: string | null;
  store_name?: string | null;
  position_name?: string | null;
  salary_period: string;
  standard_working_days?: number;
  actual_working_days?: number;
  paid_leave_days?: number;
  unpaid_leave_days?: number;
  unworked_hours?: number;
  time_deduction_amount?: number;
  contract_salary?: number;
  actual_base_salary?: number;
  overtime_salary?: number;
  position_allowance?: number;
  seniority_allowance?: number;
  project_allowance?: number;
  meal_transport_allowance?: number;
  commission_amount?: number;
  bonus_amount?: number;
  holiday_bonus?: number;
  productivity_bonus?: number;
  gross_income?: number;
  bhxh_amount?: number;
  bhyt_amount?: number;
  bhtn_amount?: number;
  total_insurance?: number;
  personal_income_tax?: number;
  penalty_deduction?: number;
  total_deduction?: number;
  net_salary?: number;
  payment_status?: string;
  payment_date?: string | null;
  details?: PayrollDetail[];
}

export interface SalesRecordCreate {
  employee_id: number;
  store_id: number;
  salary_period?: string;
  phone_revenue?: number;
  laptop_revenue?: number;
  accessory_revenue?: number;
  target_kpi?: number;
}

export interface Role {
  role_id: number;
  role_code: string;
  role_name: string;
  description?: string | null;
  permissions?: string[];
}

export interface Permission {
  permission_id: number;
  permission_code: string;
  permission_name: string;
  module: string;
}

export interface RBACMatrixItem {
  permission_code: string;
  permission_name: string;
  module: string;
  roles: Record<string, boolean>;
}

export interface User {
  user_id: number;
  username: string;
  email: string;
  phone?: string | null;
  is_active: boolean;
  last_login?: string | null;
  employee_id?: number | null;
  employee_code?: string | null;
  full_name?: string | null;
  roles: string[];
  created_at?: string | null;
}

export interface UserCreate {
  username: string;
  password: string;
  email: string;
  phone?: string;
  employee_id?: number;
  role_ids?: number[];
}

export interface UserUpdate {
  email?: string;
  phone?: string;
  is_active?: boolean;
  role_ids?: number[];
  password?: string;
}

export interface AuditLog {
  log_id: number;
  user_id?: number | null;
  username?: string | null;
  action: string;
  entity_name: string;
  entity_id?: string | null;
  old_values?: any;
  new_values?: any;
  ip_address?: string | null;
  created_at: string;
}
