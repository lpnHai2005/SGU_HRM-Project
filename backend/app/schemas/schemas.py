from datetime import datetime, date
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field, ConfigDict
try:
    from pydantic import EmailStr
except ImportError:
    EmailStr = str

# ===================================================================================
# 1. AUTH SCHEMAS
# ===================================================================================

class LoginRequest(BaseModel):
    username: str = Field(..., json_schema_extra={"example": "admin"}, description="Tên đăng nhập hệ thống")
    password: str = Field(..., json_schema_extra={"example": "123456"}, description="Mật khẩu người dùng")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    full_name: Optional[str] = None
    roles: List[str] = Field(default_factory=list)
    permissions: List[str] = Field(default_factory=list)
    employee_id: Optional[int] = None
    store_id: Optional[int] = None
    store_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UserProfile(BaseModel):
    user_id: int
    username: str
    email: str
    phone: Optional[str] = None
    is_active: bool = True
    roles: List[str] = Field(default_factory=list)
    permissions: List[str] = Field(default_factory=list)
    employee_id: Optional[int] = None
    employee_code: Optional[str] = None
    full_name: Optional[str] = None
    department_name: Optional[str] = None
    position_name: Optional[str] = None
    store_name: Optional[str] = None
    store_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class TestAccountResponse(BaseModel):
    username: str
    role: str
    name: str
    desc: str

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 2. USER SCHEMAS
# ===================================================================================

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    email: str
    phone: Optional[str] = None
    employee_id: Optional[int] = None
    role_ids: List[int] = Field(default_factory=lambda: [4]) # Mặc định là EMPLOYEE (role_id = 4)


class UserUpdate(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    role_ids: Optional[List[int]] = None
    password: Optional[str] = None


class UserResponse(BaseModel):
    user_id: int
    username: str
    email: str
    phone: Optional[str] = None
    is_active: bool
    last_login: Optional[datetime] = None
    employee_id: Optional[int] = None
    employee_code: Optional[str] = None
    full_name: Optional[str] = None
    roles: List[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 3. RBAC SCHEMAS
# ===================================================================================

class PermissionResponse(BaseModel):
    permission_id: int
    permission_code: str
    permission_name: str
    module: str

    model_config = ConfigDict(from_attributes=True)


class RoleResponse(BaseModel):
    role_id: int
    role_code: str
    role_name: str
    description: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class RBACMatrixItem(BaseModel):
    permission_code: str
    permission_name: str
    module: str
    roles: Dict[str, bool] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 4. AUDIT LOG SCHEMAS
# ===================================================================================

class AuditLogResponse(BaseModel):
    log_id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    entity_name: str
    entity_id: Optional[str] = None
    old_values: Optional[Any] = None
    new_values: Optional[Any] = None
    ip_address: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 5. EMPLOYEE & CONTRACT SCHEMAS
# ===================================================================================

class EmployeeBase(BaseModel):
    employee_code: Optional[str] = None
    first_name: str
    last_name: str
    gender: Optional[str] = "MALE"
    dob: Optional[date] = None
    identity_card: Optional[str] = None
    phone: Optional[str] = None
    personal_email: Optional[str] = None
    company_email: Optional[str] = None
    permanent_address: Optional[str] = None
    current_address: Optional[str] = None
    store_id: Optional[int] = None
    department_id: Optional[int] = None
    position_id: Optional[int] = None
    education_level_id: Optional[int] = None
    join_date: Optional[date] = None
    employment_status: Optional[str] = "ACTIVE"
    bank_account_number: Optional[str] = None
    bank_name: Optional[str] = None


class EmployeeCreate(EmployeeBase):
    basic_salary: Optional[float] = 8000000.0


class EmployeeUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    personal_email: Optional[str] = None
    current_address: Optional[str] = None
    store_id: Optional[int] = None
    department_id: Optional[int] = None
    position_id: Optional[int] = None
    employment_status: Optional[str] = None


class EmployeeOut(EmployeeBase):
    employee_id: int
    full_name: Optional[str] = None
    department_name: Optional[str] = None
    position_name: Optional[str] = None
    store_name: Optional[str] = None
    education_level_name: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PromotionCreate(BaseModel):
    employee_id: int
    new_position_id: int
    new_store_id: Optional[int] = None
    decision_number: str = "QĐ-BN-2026"
    reason: str = "Thăng cấp chức vụ theo năng lực"


class ContractCreate(BaseModel):
    employee_id: int
    contract_number: Optional[str] = None
    contract_type: str = "FIXED_1_YEAR"
    start_date: date
    end_date: Optional[date] = None
    basic_salary: Optional[float] = 8000000.0
    insurance_salary: Optional[float] = 5000000.0
    salary_percentage: Optional[float] = 100.0
    working_hours_per_week: Optional[int] = 48
    signed_date: Optional[date] = None


class ContractOut(ContractCreate):
    contract_id: int
    contract_number: str
    status: str = "ACTIVE"
    employee_name: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 6. ATTENDANCE & SCHEDULE SCHEMAS
# ===================================================================================

class ShiftScheduleCreate(BaseModel):
    employee_id: int
    store_id: int
    shift_id: int
    work_date: date
    notes: Optional[str] = None


class ShiftScheduleOut(ShiftScheduleCreate):
    schedule_id: int
    employee_name: Optional[str] = None
    shift_name: Optional[str] = None
    store_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CheckInRequest(BaseModel):
    employee_id: Optional[int] = None
    shift_id: int = 1
    notes: Optional[str] = None


class CheckOutRequest(BaseModel):
    attendance_id: int
    notes: Optional[str] = None


class AttendanceOut(BaseModel):
    attendance_id: int
    employee_id: int
    employee_name: Optional[str] = None
    store_id: Optional[int] = None
    store_name: Optional[str] = None
    shift_id: Optional[int] = None
    shift_name: Optional[str] = None
    work_date: date
    check_in_time: Optional[datetime] = None
    check_out_time: Optional[datetime] = None
    late_minutes: Optional[int] = 0
    early_minutes: Optional[int] = 0
    overtime_hours: Optional[float] = 0.0
    actual_work_hours: Optional[float] = 0.0
    status: str = "NORMAL"
    notes: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 7. LEAVE SCHEMAS
# ===================================================================================

class LeaveTypeOut(BaseModel):
    leave_type_id: int
    type_code: str
    type_name: str
    is_paid: bool
    max_days_allowed: int
    requires_attachment: bool = False

    model_config = ConfigDict(from_attributes=True)


class LeaveBalanceOut(BaseModel):
    employee_id: int
    employee_name: Optional[str] = None
    annual_leave_total: float = 12.0
    annual_leave_used: float = 0.0
    annual_leave_remaining: float = 12.0
    sick_leave_used: float = 0.0
    pending_leave_days: float = 0.0
    maternity_leave_used: float = 0.0
    unpaid_leave_used: float = 0.0
    seniority_bonus_days: float = 0.0

    model_config = ConfigDict(from_attributes=True)


class LeaveRequestCreate(BaseModel):
    leave_type_id: int
    start_date: date
    end_date: date
    total_days: float
    reason: str
    attachment_url: Optional[str] = None


class LeaveApproveRequest(BaseModel):
    note: Optional[str] = None


class LeaveRejectRequest(BaseModel):
    rejection_reason: str


class LeaveRequestOut(BaseModel):
    request_id: int
    employee_id: int
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    store_id: Optional[int] = None
    store_name: Optional[str] = None
    department_name: Optional[str] = None
    position_name: Optional[str] = None
    leave_type_id: int
    leave_type_name: Optional[str] = None
    leave_type_code: Optional[str] = None
    start_date: date
    end_date: date
    total_days: Optional[float] = 0.0
    reason: Optional[str] = None
    status: str = "PENDING"
    attachment_url: Optional[str] = None
    store_manager_id: Optional[int] = None
    store_manager_name: Optional[str] = None
    store_approved_at: Optional[datetime] = None
    store_manager_note: Optional[str] = None
    hr_approver_id: Optional[int] = None
    hr_approver_name: Optional[str] = None
    hr_approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    rejected_by_id: Optional[int] = None
    rejected_by_name: Optional[str] = None
    rejected_by_role: Optional[str] = None
    rejected_at: Optional[datetime] = None
    is_store_manager_request: Optional[bool] = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 8. SALES & PAYROLL SCHEMAS
# ===================================================================================

class SalesRecordCreate(BaseModel):
    employee_id: int
    store_id: int
    salary_period: str = "2026-09"
    phone_revenue: float = 0.0
    laptop_revenue: float = 0.0
    accessory_revenue: float = 0.0
    target_kpi: float = 100000000.0


class SalesRecordOut(SalesRecordCreate):
    sale_record_id: int
    total_revenue: float = 0.0
    kpi_achievement_rate: float = 0.0
    employee_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CalculatePayrollRequest(BaseModel):
    salary_period: str = Field(..., json_schema_extra={"example": "2026-09"})


class PayrollDetailOut(BaseModel):
    detail_id: int
    item_code: str
    item_name: str
    item_type: str
    calculation_formula: Optional[str] = None
    amount: Optional[float] = 0.0
    notes: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class PayrollOut(BaseModel):
    payroll_id: int
    employee_id: int
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    store_name: Optional[str] = None
    position_name: Optional[str] = None
    salary_period: str
    standard_working_days: Optional[float] = 26.0
    actual_working_days: Optional[float] = 0.0
    paid_leave_days: Optional[float] = 0.0
    unpaid_leave_days: Optional[float] = 0.0
    unworked_hours: Optional[float] = 0.0
    time_deduction_amount: Optional[float] = 0.0
    contract_salary: Optional[float] = 0.0
    actual_base_salary: Optional[float] = 0.0
    overtime_salary: Optional[float] = 0.0
    position_allowance: Optional[float] = 0.0
    seniority_allowance: Optional[float] = 0.0
    project_allowance: Optional[float] = 0.0
    meal_transport_allowance: Optional[float] = 0.0
    commission_amount: Optional[float] = 0.0
    bonus_amount: Optional[float] = 0.0
    holiday_bonus: Optional[float] = 0.0
    productivity_bonus: Optional[float] = 0.0
    gross_income: Optional[float] = 0.0
    bhxh_amount: Optional[float] = 0.0
    bhyt_amount: Optional[float] = 0.0
    bhtn_amount: Optional[float] = 0.0
    total_insurance: Optional[float] = 0.0
    personal_income_tax: Optional[float] = 0.0
    penalty_deduction: Optional[float] = 0.0
    total_deduction: Optional[float] = 0.0
    net_salary: Optional[float] = 0.0
    payment_status: Optional[str] = "DRAFT"
    payment_date: Optional[date] = None
    details: List[PayrollDetailOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class SalesRecordUpdate(BaseModel):
    phone_revenue: Optional[float] = None
    laptop_revenue: Optional[float] = None
    accessory_revenue: Optional[float] = None
    target_kpi: Optional[float] = None


class CommissionOut(BaseModel):
    commission_id: int
    sale_record_id: Optional[int] = None
    employee_id: int
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    salary_period: str
    commission_rate: Optional[float] = 1.00
    commission_amount: float = 0.0
    kpi_bonus_amount: float = 0.0
    notes: Optional[str] = None
    phone_revenue: Optional[float] = 0.0
    laptop_revenue: Optional[float] = 0.0
    accessory_revenue: Optional[float] = 0.0
    total_revenue: Optional[float] = 0.0
    kpi_achievement_rate: Optional[float] = 0.0
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PayrollStatusUpdate(BaseModel):
    payment_status: str = Field(..., json_schema_extra={"example": "CONFIRMED"}, description="DRAFT, CONFIRMED, PAID")
    payment_date: Optional[date] = None


class BatchPayrollStatusRequest(BaseModel):
    salary_period: str = Field(..., json_schema_extra={"example": "2026-09"})
    payment_status: str = Field("CONFIRMED", json_schema_extra={"example": "CONFIRMED"}, description="CONFIRMED or PAID")
    payment_date: Optional[date] = None


# ===================================================================================
# 9. PROJECT SCHEMAS
# ===================================================================================

class ProjectCreate(BaseModel):
    project_code: str
    project_name: str
    description: Optional[str] = None
    start_date: date
    end_date: Optional[date] = None
    status: Optional[str] = "IN_PROGRESS"
    budget: Optional[float] = 0.0


class ProjectUpdate(BaseModel):
    project_name: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    budget: Optional[float] = None


class ProjectMemberCreate(BaseModel):
    employee_id: int
    project_role: Optional[str] = "MEMBER"
    project_allowance: Optional[float] = 0.0
    joined_date: date
    left_date: Optional[date] = None
    is_active: Optional[bool] = True


class ProjectMemberUpdate(BaseModel):
    project_role: Optional[str] = None
    project_allowance: Optional[float] = None
    left_date: Optional[date] = None
    is_active: Optional[bool] = None


class ProjectMemberOut(BaseModel):
    project_member_id: int
    project_id: int
    employee_id: int
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    position_name: Optional[str] = None
    project_role: str = "Thành viên"
    project_allowance: Optional[float] = 0.0
    joined_date: date
    left_date: Optional[date] = None
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)


class ProjectOut(BaseModel):
    project_id: int
    project_code: str
    project_name: str
    description: Optional[str] = None
    start_date: date
    end_date: Optional[date] = None
    status: str = "IN_PROGRESS"
    budget: Optional[float] = 0.0
    members: List[ProjectMemberOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


# ===================================================================================
# 10. AI COPILOT SCHEMAS
# ===================================================================================

class AICopilotQuery(BaseModel):
    query: str
    user_context: Optional[Dict[str, Any]] = None


class AICopilotResponse(BaseModel):
    answer: str
    sources: List[str] = Field(default_factory=list)
    confidence: float = 0.95
