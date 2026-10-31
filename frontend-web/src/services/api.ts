// ============================================
// API Configuration
// ============================================

import { resolveApiBaseUrl } from './apiBaseUrl';

const API_BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window === 'undefined' ? 'localhost' : window.location.hostname,
  import.meta.env.DEV,
);

// ============================================
// Token Management
// ============================================

const TOKEN_KEY = 'hrm_token';
const USER_KEY = 'hrm_user';

const friendlyApiMessages: Record<string, string> = {
  OT_RECONCILIATION_SCHEMA_NOT_INSTALLED: 'Máy chủ chưa cài schema đối soát OT. Liên hệ quản trị viên; không thử xác nhận lại.',
  OT_RECONCILIATION_STALE: 'Dữ liệu đơn OT hoặc chấm công đã thay đổi. Hãy tải lại kết quả đối soát.',
  OT_RECONCILIATION_NEEDS_REVIEW: 'Dữ liệu chấm công cần rà soát trước khi xác nhận giờ OT.',
  OT_RECONCILIATION_NOT_READY: 'Chưa đến thời điểm đối soát. Có thể xem trước hoặc quyết định sau khi khung giờ OT kết thúc.',
  OT_VERIFIED_INTERVAL_CONFLICT: 'Nhân viên đã có giờ OT xác nhận trong khung giờ giao nhau. Hãy kiểm tra đơn liên quan.',
  SCHEDULE_CONFLICT: 'Nhân viên đã có ca làm việc trùng thời gian. Hãy chọn ca khác hoặc điều chỉnh lịch đang xung đột.',
  SCHEDULE_AMBIGUOUS: 'Có nhiều lịch phù hợp với thao tác này. Hãy chọn đúng ca được phân công rồi thử lại.',
  SCHEDULE_REFERENCED: 'Lịch này đã được dùng để chấm công nên không thể sửa trực tiếp. Hãy dùng quy trình điều chỉnh lịch có ghi nhận.',
  STORE_INACTIVE: 'Cửa hàng đang ngừng hoạt động nên không thể thực hiện thao tác này.',
  EMPLOYEE_NOT_ELIGIBLE: 'Nhân viên hiện không đủ điều kiện được phân ca. Hãy kiểm tra trạng thái làm việc của nhân viên.',
  STORE_HAS_OPEN_ATTENDANCE: 'Cửa hàng còn phiên chấm công chưa kết thúc. Hãy hoàn tất các phiên trước rồi thử lại.',
  STORE_MANAGER_REQUIRED: 'Cần phân công cửa hàng trưởng trước khi kích hoạt cửa hàng.',
  STORE_MANAGER_INVALID: 'Cửa hàng trưởng hiện không còn đủ điều kiện phụ trách. Hãy chọn người phụ trách khác.',
  STORE_MANAGER_ALREADY_ASSIGNED: 'Cửa hàng trưởng đang phụ trách một chi nhánh khác. Hãy xử lý phân công hiện tại trước.',
  STORE_GEOFENCE_REQUIRED: 'Cửa hàng chưa có tọa độ và bán kính GPS hợp lệ. Hãy cập nhật vùng chấm công trước.',
  STORE_MUST_BE_INACTIVE: 'Hãy ngừng hoạt động cửa hàng trước khi xóa.',
  STORE_CONFIRMATION_MISMATCH: 'Mã xác nhận chưa khớp với mã cửa hàng.',
  STORE_HAS_LINKED_RECORDS: 'Cửa hàng còn dữ liệu liên quan nên không thể xóa. Hãy giữ cửa hàng ở trạng thái ngừng hoạt động.',
  STORE_DELETE_CONSTRAINT: 'Cửa hàng còn dữ liệu nghiệp vụ liên kết nên chưa thể xóa an toàn.',
  STORE_HANDOFF_CONFIRMATION_REQUIRED: 'Cần xác nhận phương án bàn giao nhân sự và lịch còn hiệu lực trước khi ngừng cửa hàng.',
  OVERTIME_REQUEST_CONFLICT: 'Nhân viên đã có đăng ký OT trùng khung giờ. Hãy kiểm tra lịch OT hiện có.',
  OT_SCHEMA_NOT_INSTALLED: 'Chức năng đăng ký OT chưa được kích hoạt trên máy chủ. Quản trị viên cần áp dụng migration OT đã được phê duyệt; không cần gửi lại liên tục.',
  OT_LEGACY_APPROVAL_CLOSED: 'Phiên thuộc giai đoạn đăng ký OT mới. Không thể duyệt giờ ngoài ca qua luồng cũ; hãy liên hệ HR để đối chiếu theo quy chế mới.',
  OT_PAYROLL_REVIEW_REQUIRED: 'Kỳ lương có giờ ngoài ca cần đối chiếu theo quy chế OT mới. Hãy rà soát trước khi tính hoặc chốt lương.',
  OT_PAYROLL_PERIOD_ON_HOLD: 'Kỳ lương đang được giữ để rà soát OT theo quy chế mới. Chưa thể tính hoặc chốt kỳ này.',
  WORK_SCHEDULE_CONFLICT: 'Khung giờ OT trùng ca làm việc đã phân. Hãy chọn giờ khác ngoài ca.',
  LEAVE_CONFLICT: 'Nhân viên đang có đơn nghỉ trong ngày này nên không thể đăng ký OT.',
  EMPLOYEE_STORE_CHANGED: 'Nhân viên đã được chuyển cửa hàng. Hãy tải lại danh sách và tạo lại đăng ký.',
  PROOF_IMAGE_PROVIDER_ERROR: 'Nhà cung cấp ảnh chưa xử lý được minh chứng. Kiểm tra lại ảnh hoặc báo quản trị viên kèm mã HTTP hiển thị.',
};

export function formatApiError(detail: unknown, status?: number): string {
  let value = detail;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { value = JSON.parse(trimmed); } catch { /* keep the original message */ }
    }
  }
  if (value && typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    const code = typeof payload.code === 'string' ? payload.code : '';
    if (code && friendlyApiMessages[code]) {
      if (code === 'PROOF_IMAGE_PROVIDER_ERROR' && payload.provider_status === 400) {
        return 'Dịch vụ ảnh từ chối xử lý minh chứng (HTTP 400). Quản trị viên cần kiểm tra quyền truy cập và cấu hình biến đổi ảnh Cloudinary; bạn không cần chấm công lại.';
      }
      const upstreamStatus = typeof payload.provider_status === 'number' ? ` (HTTP ${payload.provider_status})` : '';
      return friendlyApiMessages[code] + upstreamStatus;
    }
    if (typeof payload.message === 'string' && payload.message.trim()) return formatApiError(payload.message, status);
    if (code === 'SCHEDULE_CONFLICT') return friendlyApiMessages.SCHEDULE_CONFLICT;
    return status ? `Không thể hoàn tất yêu cầu (HTTP ${status}). Vui lòng kiểm tra dữ liệu và thử lại.` : 'Không thể hoàn tất yêu cầu. Vui lòng kiểm tra dữ liệu và thử lại.';
  }
  if (typeof value === 'string' && value.trim()) {
    const raw = value.trim();
    const prefix = raw.match(/^([A-Z][A-Z0-9_]+):\s*(.*)$/);
    if (prefix) {
      if (friendlyApiMessages[prefix[1]]) return friendlyApiMessages[prefix[1]];
      return prefix[2] || (status ? `Yêu cầu chưa thể thực hiện (HTTP ${status}).` : 'Yêu cầu chưa thể thực hiện.');
    }
    return raw;
  }
  return status ? `Yêu cầu thất bại (HTTP ${status}). Vui lòng thử lại.` : 'Yêu cầu thất bại. Vui lòng thử lại.';
}

export const tokenService = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  remove: () => localStorage.removeItem(TOKEN_KEY),
};

export const userService = {
  get: () => {
    const user = localStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
  },
  set: (user: any) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  remove: () => localStorage.removeItem(USER_KEY),
};

export const clearAuth = () => {
  tokenService.remove();
  userService.remove();
};

// ============================================
// HTTP Client
// ============================================

interface RequestOptions extends RequestInit {
  params?: Record<string, any>
}

export class ApiHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(isFormData: boolean = false): HeadersInit {
    const headers: Record<string, string> = {};

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    const token = tokenService.get();
    if (token && token !== 'null' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  private buildUrl(endpoint: string, params?: Record<string, any>): string {
    const url = new URL(`${this.baseUrl}${endpoint}`, window.location.origin);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options;
    const url = this.buildUrl(endpoint, params);
    const isFormData = fetchOptions.body instanceof FormData;

    const config: RequestInit = {
      ...fetchOptions,
      headers: {
        ...this.getHeaders(isFormData),
        ...fetchOptions.headers,
      },
    };

    try {
      const response = await fetch(url, config);

      // Handle 401 Unauthorized
      // Only treat 401 as session-expiry when the user was authenticated.
      // A 401 forwarded from an upstream proxy (e.g. /stores/poi-search →
      // TrackAsia) must NOT clear auth or redirect – it is a server-side
      // configuration problem, not a user session problem.
      if (response.status === 401) {
        const token = tokenService.get();
        if (token) {
          // The backend rejected our own JWT → genuine session expiry.
          clearAuth();
          window.location.href = '/login';
          throw new Error('Phiên đăng nhập đã hết hạn');
        }
        // No token in storage → treat as a regular API error (e.g. bad API key).
        const errorData = await response.json().catch(() => ({}));
        throw new ApiHttpError(formatApiError(errorData.detail, response.status), response.status);
      }

      // Handle other errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiHttpError(formatApiError(errorData.detail, response.status), response.status);
      }

      // Handle empty responses
      const text = await response.text();
      return text ? JSON.parse(text) : ({} as T);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Đã xảy ra lỗi không xác định');
    }
  }

  // HTTP Methods
  get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }

  async getBlob(endpoint: string, params?: Record<string, any>): Promise<Blob> {
    const response = await fetch(this.buildUrl(endpoint, params), {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (response.status === 401) {
      if (tokenService.get()) {
        clearAuth();
        window.location.href = '/login';
      }
      throw new Error('Không có quyền tải minh chứng hoặc phiên đăng nhập đã hết hạn.');
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(formatApiError(errorData.detail, response.status));
    }
    return response.blob();
  }

  post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  upload<T>(endpoint: string, formData: FormData): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: formData,
    });
  }
}

export const api = new ApiClient(API_BASE_URL);

// ============================================
// Auth API
// ============================================

import type {
  LoginRequest,
  TokenResponse,
  UserProfile,
  TestAccountResponse,
} from '../types';

export const authApi = {
  login: async (username: string, password: string): Promise<TokenResponse> => {
    const response = await api.post<TokenResponse>('/auth/login', {
      username,
      password,
    } as LoginRequest);

    // Save token and user info
    tokenService.set(response.access_token);
    userService.set({
      user_id: response.user_id,
      username: response.username,
      full_name: response.full_name,
      roles: response.roles,
      permissions: response.permissions,
      employee_id: response.employee_id,
      store_id: response.store_id,
      store_name: response.store_name,
      avatar_url: response.avatar_url,
    });

    return response;
  },

  getMe: async (): Promise<UserProfile> => {
    return api.get<UserProfile>('/auth/me');
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<{ message: string }> => {
    return api.post<{ message: string }>('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  uploadAvatar: async (payload: { avatar_base64: string }): Promise<{ message: string; avatar_url: string }> => {
    return api.post<{ message: string; avatar_url: string }>('/auth/avatar', payload);
  },

  uploadAvatarFile: async (file: File): Promise<{ message: string; avatar_url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.upload<{ message: string; avatar_url: string }>('/auth/avatar/file', formData);
  },

  logout: async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearAuth();
    }
  },

  getTestAccounts: async (): Promise<TestAccountResponse[]> => {
    return api.get<TestAccountResponse[]>('/auth/test-accounts');
  },

  isAuthenticated: (): boolean => {
    return !!tokenService.get();
  },
};

// ============================================
// Employee API
// ============================================

import type {
  Employee,
  EmployeeCreate,
  EmployeeUpdate,
  PromotionCreate,
  Contract,
  ContractCreate,
  ContractUpdate,
  Lookups,
} from '../types';

export const employeeApi = {
  getAll: async (params?: {
    store_id?: number
    department_id?: number
    status?: string
    search?: string
    conditions?: string
  }): Promise<Employee[]> => {
    return api.get<Employee[]>('/employees', params);
  },

  getById: async (employeeId: number): Promise<Employee> => {
    return api.get<Employee>(`/employees/${employeeId}`);
  },

  create: async (data: EmployeeCreate): Promise<Employee> => {
    return api.post<Employee>('/employees', data);
  },

  update: async (employeeId: number, data: EmployeeUpdate): Promise<Employee> => {
    return api.put<Employee>(`/employees/${employeeId}`, data);
  },

  delete: async (employeeId: number): Promise<{ message: string }> => {
    return api.delete<{ message: string }>(`/employees/${employeeId}`);
  },

  promote: async (data: PromotionCreate): Promise<{ message: string; new_position_id: number }> => {
    return api.post('/employees/promotions', data);
  },

  getContracts: async (employeeId?: number): Promise<Contract[]> => {
    return api.get<Contract[]>('/employees/contracts', employeeId ? { employee_id: employeeId } : undefined);
  },

  createContract: async (data: ContractCreate): Promise<{ message: string; contract_number: string }> => {
    return api.post('/employees/contracts', data);
  },

  updateContract: async (contractId: number, data: ContractUpdate): Promise<{ message: string; contract_id: number }> => {
    return api.put(`/employees/contracts/${contractId}`, data);
  },

  deleteContract: async (contractId: number): Promise<{ message: string }> => {
    return api.delete(`/employees/contracts/${contractId}`);
  },

  getLookups: async (): Promise<Lookups> => {
    return api.get<Lookups>('/employees/metadata/lookups');
  },
};

import type { WorkSchedule, WorkScheduleQuery, WorkScheduleWrite } from '../types';

export const workScheduleApi = {
  getAll: (params: WorkScheduleQuery): Promise<WorkSchedule[]> =>
    api.get<WorkSchedule[]>('/work-schedules', params),

  create: (data: WorkScheduleWrite): Promise<WorkSchedule> =>
    api.post<WorkSchedule>('/work-schedules', data),

  createBatch: (assignments: WorkScheduleWrite[]): Promise<WorkSchedule[]> =>
    api.post<WorkSchedule[]>('/work-schedules/batch', { assignments }),

  update: (scheduleId: number, data: WorkScheduleWrite): Promise<WorkSchedule> =>
    api.put<WorkSchedule>(`/work-schedules/${scheduleId}`, data),

  cancel: (scheduleId: number, reason: string): Promise<WorkSchedule> =>
    api.post<WorkSchedule>(`/work-schedules/${scheduleId}/cancel`, { reason }),

  assignFixed: (data: { employee_id: number; store_id: number; shift_id: number; work_date: string; notes?: string; reason?: string; weekdays?: string; end_date?: string }): Promise<{ message: string; rule_id?: number }> =>
    api.post('/fixed-schedules', data),

  assignFixedBatch: (assignments: Array<{ employee_id: number; store_id: number; shift_id: number; work_date: string; notes?: string; reason?: string; weekdays?: string; end_date?: string }>): Promise<{ rules: any[]; message: string }> =>
    api.post('/fixed-schedules/batch', { assignments }),

  getFixedRules: (employee_id: number): Promise<any[]> =>
    api.get('/fixed-schedules', { employee_id }),

  updateFixed: (ruleId: number, data: { effective_date: string; shift_id: number; weekdays: string; notes: string; end_date: string | null; reason: string }): Promise<{ message: string; created_count: number }> =>
    api.put(`/fixed-schedules/${ruleId}`, data),

  stopFixed: (ruleId: number, reason: string, effective_date?: string): Promise<{ message: string }> =>
    api.post(`/fixed-schedules/${ruleId}/stop`, { reason, effective_date }),
};

import type { OvertimeReconciliation, OvertimeReconciliationCase, OvertimeRequest } from '../types';

export const overtimeReconciliationApi = {
  list: (params: { status?: string; date_from?: string; date_to?: string; store_id?: number; limit?: number } = {}): Promise<OvertimeReconciliation[]> =>
    api.get('/overtime-reconciliations', params),
  detail: (requestId: number): Promise<OvertimeReconciliation> =>
    api.get(`/overtime-reconciliations/${requestId}`),
  preview: (requestId: number): Promise<OvertimeReconciliation> =>
    api.post(`/overtime-reconciliations/${requestId}/preview`, {}),
  verify: (requestId: number, expected_version: number, reason?: string): Promise<OvertimeReconciliation> =>
    api.post(`/overtime-reconciliations/${requestId}/verify`, { expected_version, reason }),
  reject: (requestId: number, expected_version: number, reason: string): Promise<OvertimeReconciliation> =>
    api.post(`/overtime-reconciliations/${requestId}/reject`, { expected_version, reason }),
  reopen: (requestId: number, expected_version: number, reason: string): Promise<OvertimeReconciliation> =>
    api.post(`/overtime-reconciliations/${requestId}/reopen`, { expected_version, reason }),
  requestExplanation: (requestId: number, expected_version: number, reason: string): Promise<OvertimeReconciliationCase> =>
    api.post(`/overtime-reconciliations/${requestId}/explanation-requests`, { expected_version, reason }),
  respondToExplanation: (requestId: number, caseId: number, expected_case_version: number, response: string): Promise<OvertimeReconciliationCase> =>
    api.post(`/overtime-reconciliations/${requestId}/explanation-cases/${caseId}/respond`, { expected_case_version, response }),
  closeExplanation: (requestId: number, caseId: number, expected_case_version: number, reason: string): Promise<OvertimeReconciliationCase> =>
    api.post(`/overtime-reconciliations/${requestId}/explanation-cases/${caseId}/close`, { expected_case_version, reason }),
  requestReview: (requestId: number, expected_reconciliation_version: number, reason: string): Promise<OvertimeReconciliationCase> =>
    api.post(`/overtime-reconciliations/${requestId}/review-requests`, { expected_reconciliation_version, reason }),
  decideReview: (requestId: number, caseId: number, expected_case_version: number,
    expected_reconciliation_version: number, decision: 'ACCEPT' | 'REJECT', reason: string): Promise<{
      case: OvertimeReconciliationCase
      reconciliation: OvertimeReconciliation
    }> => api.post(`/overtime-reconciliations/${requestId}/review-requests/${caseId}/decision`, {
      expected_case_version, expected_reconciliation_version, decision, reason,
    }),
};

export const overtimeRequestApi = {
  count: (): Promise<{ count: number }> =>
    api.get<{ count: number }>('/overtime-requests/count'),

  list: (params: { date_from: string; date_to: string; store_id?: number; employee_id?: number; status?: string; q?: string; limit?: number; offset?: number }): Promise<OvertimeRequest[]> =>
    api.get<OvertimeRequest[]>('/overtime-requests', params),

  detail: (requestId: number): Promise<OvertimeRequest> =>
    api.get<OvertimeRequest>(`/overtime-requests/${requestId}`),

  create: (data: Pick<OvertimeRequest, 'employee_id' | 'work_date' | 'reason'> & {
    store_id?: number
    start_time: string
    end_time: string
    notes?: string
  }, idempotencyKey: string): Promise<OvertimeRequest> => api.request<OvertimeRequest>('/overtime-requests', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  }),

  submit: (requestId: number): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/submit`, {}),

  employeeConfirm: (requestId: number): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/employee-confirm`, {}),

  employeeDecline: (requestId: number, reason?: string): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/employee-decline`, reason?.trim() ? { reason: reason.trim() } : {}),

  approve: (requestId: number): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/approve`, {}),

  reject: (requestId: number, reason: string): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/reject`, { reason }),

  cancel: (requestId: number, reason?: string): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/cancel`, reason?.trim() ? { reason: reason.trim() } : {}),

  requestRevocation: (requestId: number, reason: string): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/revoke-request`, { reason }),

  approveRevocation: (requestId: number): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/revoke-approve`, {}),

  rejectRevocation: (requestId: number, reason: string): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/revoke-reject`, { reason }),

  proposeAmendment: (requestId: number, data: {
    work_date: string
    start_time: string
    end_time: string
    reason: string
    notes?: string
  }): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/amend`, data),

  approveAmendment: (requestId: number): Promise<OvertimeRequest> =>
    api.post<OvertimeRequest>(`/overtime-requests/${requestId}/amend-approve`, {}),
};

// ============================================
// Attendance API
// ============================================

import type {
  Attendance,
  CheckInRequest,
  CheckOutRequest,
  CheckInResponse,
  CheckOutResponse,
  ShiftSchedule,
  ShiftScheduleCreate,
  WorkShift,
  AttendanceSummary,
  TodayAttendanceStatus,
} from '../types';

export const attendanceApi = {
  getShifts: async (): Promise<WorkShift[]> => {
    return api.get<WorkShift[]>('/attendances/shifts');
  },

  getTodayStatus: async (employee_id?: number): Promise<TodayAttendanceStatus> => {
    return api.get<TodayAttendanceStatus>('/attendances/today-status', employee_id ? { employee_id } : undefined);
  },

  getMySummary: async (period?: string, employee_id?: number): Promise<AttendanceSummary> => {
    const params: Record<string, any> = {};
    if (period) params.period = period;
    if (employee_id) params.employee_id = employee_id;
    return api.get<AttendanceSummary>('/attendances/my-summary', Object.keys(params).length ? params : undefined);
  },

  getAll: async (params?: {
    work_date?: string;
    period?: string;
    store_id?: number;
    employee_id?: number;
    status?: string;
  }): Promise<Attendance[]> => {
    return api.get<Attendance[]>('/attendances', params);
  },

  getMyHistory: async (period?: string): Promise<Attendance[]> => {
    return api.get<Attendance[]>('/attendances/my-history', period ? { period } : undefined);
  },

  checkIn: async (data?: CheckInRequest): Promise<CheckInResponse> => {
    return api.post<CheckInResponse>('/attendances/check-in', data || {});
  },

  checkOut: async (data?: CheckOutRequest): Promise<CheckOutResponse> => {
    return api.post<CheckOutResponse>('/attendances/check-out', data || {});
  },

  getShiftSchedules: async (params?: {
    store_id?: number;
    work_date?: string;
  }): Promise<ShiftSchedule[]> => {
    return api.get<ShiftSchedule[]>('/attendances/shift-schedules', params);
  },

  assignShiftSchedule: async (data: ShiftScheduleCreate): Promise<{ message: string }> => {
    return api.post('/attendances/shift-schedules', data);
  },
  assignFixedSchedule: async (data: ShiftScheduleCreate): Promise<{ message: string }> => {
    return api.post('/fixed-schedules', data);
  },
  getFixedSchedules: async (employee_id: number): Promise<{ rule_id: number; start_date: string; last_error: string | null }[]> => {
    return api.get('/fixed-schedules', { employee_id });
  },
  stopFixedSchedule: async (ruleId: number): Promise<{ message: string }> => {
    return api.post(`/fixed-schedules/${ruleId}/stop`, { reason: 'Quản lý dừng ca cố định từ bảng phân ca' });
  },
};

// ============================================
// Leave API
// ============================================

import type {
  LeaveType,
  LeaveBalance,
  LeaveRequest,
  LeaveRequestCreate,
  LeaveApproveRequest,
  LeaveRejectRequest,
} from '../types';

export const leaveApi = {
  getTypes: async (): Promise<LeaveType[]> => {
    return api.get<LeaveType[]>('/leaves/types');
  },

  getAll: async (params?: { status?: string; employee_id?: number }): Promise<LeaveRequest[]> => {
    return api.get<LeaveRequest[]>('/leaves', params);
  },

  getMyBalance: async (): Promise<LeaveBalance> => {
    return api.get<LeaveBalance>('/leaves/balances/me');
  },

  getEmployeeBalance: async (employeeId: number): Promise<LeaveBalance> => {
    return api.get<LeaveBalance>(`/leaves/balances/${employeeId}`);
  },

  create: async (data: LeaveRequestCreate): Promise<{ message: string; request_id: number }> => {
    return api.post('/leaves', data);
  },

  approveStore: async (
    requestId: number,
    data?: LeaveApproveRequest
  ): Promise<{ message: string }> => {
    return api.post(`/leaves/${requestId}/approve-store`, data);
  },

  approveHr: async (requestId: number): Promise<{ message: string }> => {
    return api.post(`/leaves/${requestId}/approve-hr`);
  },

  reject: async (
    requestId: number,
    data: LeaveRejectRequest
  ): Promise<{ message: string }> => {
    return api.post(`/leaves/${requestId}/reject`, data);
  },

  getStats: async (): Promise<{
    total_requests: number;
    pending_store_approval: number;
    pending_hr_approval: number;
    approved: number;
    rejected: number;
    on_leave_today: number;
  }> => {
    return api.get('/leaves/summary/stats');
  },

  getCalendar: async (params?: { month?: string; store_id?: number; employee_id?: number }): Promise<LeaveRequest[]> => {
    return api.get<LeaveRequest[]>('/leaves/calendar', params);
  },

  getById: async (requestId: number): Promise<LeaveRequest> => {
    return api.get<LeaveRequest>(`/leaves/${requestId}`);
  },

  cancel: async (requestId: number): Promise<{ message: string }> => {
    return api.post(`/leaves/${requestId}/cancel`);
  },

  uploadProof: async (file: File): Promise<{ proof_url: string; filename: string; size_bytes: number; content_type: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.upload('/leaves/upload-proof', formData);
  },
};

// ============================================
// Payroll API
// ============================================

import type {
  Payroll,
  SalesRecordCreate,
  Project,
  ProjectRole,
  ProjectRoleAllowance,
  PayrollPolicySetting,
  PayrollPeriodBonus,
  PublicHoliday,
  PayrollPeriodWorkingDays,
} from '../types';

export const payrollApi = {
  getAll: async (params?: {
    period?: string
    store_id?: number
    employee_id?: number
    payment_status?: string
  }): Promise<Payroll[]> => {
    return api.get<Payroll[]>('/payrolls', params);
  },

  getById: async (payrollId: number): Promise<Payroll> => {
    return api.get<Payroll>(`/payrolls/${payrollId}`);
  },

  calculate: async (period: string): Promise<{
    message: string
    salary_period: string
    total_employees_calculated?: number
    total_gross_income?: number
    total_net_salary?: number
  }> => {
    return api.post('/payrolls/calculate', { salary_period: period });
  },

  generate: async (month: string): Promise<Payroll[]> => {
    return api.post<Payroll[]>(`/payrolls/generate/${month}`);
  },

  generateMonth: async (month: string): Promise<Payroll[]> => {
    return api.get<Payroll[]>(`/payroll/generate/${month}`);
  },

  getAnnualSummary: async (
    employeeId: number,
    year?: string
  ): Promise<any> => {
    return api.get(`/payrolls/employee/${employeeId}/annual`, year ? { year } : undefined);
  },

  recordSales: async (data: SalesRecordCreate): Promise<{ message: string }> => {
    return api.post('/payrolls/sales-records', data);
  },

  getCommissions: async (month: string): Promise<any[]> => {
    return api.get(`/payrolls/commissions/calculate/${month}`);
  },

  getProjects: async (): Promise<Project[]> => {
    return api.get<Project[]>('/payrolls/projects/list');
  },

  createProject: async (data: {
    project_code: string;
    project_name: string;
    description?: string;
    start_date: string;
    end_date?: string;
    status?: string;
    budget?: number;
  }): Promise<{ message: string; project: Project }> => {
    return api.post('/payrolls/projects', data);
  },

  getProjectRoles: async (): Promise<ProjectRole[]> => {
    return api.get<ProjectRole[]>('/payrolls/projects/roles');
  },

  createProjectRole: async (data: { role_code: string; role_name: string; description?: string; display_order?: number }): Promise<ProjectRole> => {
    return api.post<ProjectRole>('/payrolls/projects/roles', data);
  },

  getProjectRoleAllowances: async (projectId: number): Promise<ProjectRoleAllowance[]> => {
    return api.get<ProjectRoleAllowance[]>(`/payrolls/projects/${projectId}/role-allowances`);
  },

  setProjectRoleAllowance: async (projectId: number, data: { role_code: string; allowance_amount: number; notes?: string }): Promise<ProjectRoleAllowance> => {
    return api.post<ProjectRoleAllowance>(`/payrolls/projects/${projectId}/role-allowances`, data);
  },

  addProjectMember: async (projectId: number, data: { employee_id: number; project_role?: string; project_allowance?: number; joined_date: string; left_date?: string }): Promise<any> => {
    return api.post(`/payrolls/projects/${projectId}/members`, data);
  },

  updateProjectMember: async (memberId: number, data: { project_role?: string; project_allowance?: number; is_active?: boolean }): Promise<any> => {
    return api.put(`/payrolls/projects/members/${memberId}`, data);
  },

  removeProjectMember: async (memberId: number): Promise<any> => {
    return api.delete(`/payrolls/projects/members/${memberId}`);
  },

  getPolicySettings: async (): Promise<PayrollPolicySetting[]> => {
    return api.get<PayrollPolicySetting[]>('/payrolls/policies/settings');
  },

  updatePolicySetting: async (key: string, data: { numeric_value: number; description?: string }): Promise<PayrollPolicySetting> => {
    return api.put<PayrollPolicySetting>(`/payrolls/policies/settings/${key}`, data);
  },

  getPeriodBonuses: async (period?: string): Promise<PayrollPeriodBonus[]> => {
    return api.get<PayrollPeriodBonus[]>('/payrolls/policies/period-bonuses', period ? { period } : undefined);
  },

  createPeriodBonus: async (data: { salary_period: string; bonus_code: string; bonus_name: string; calculation_type: string; base_amount: number; applies_to?: string; is_recurring?: boolean }): Promise<PayrollPeriodBonus> => {
    return api.post<PayrollPeriodBonus>('/payrolls/policies/period-bonuses', data);
  },

  updatePeriodBonus: async (bonusId: number, data: Partial<PayrollPeriodBonus>): Promise<PayrollPeriodBonus> => {
    return api.put<PayrollPeriodBonus>(`/payrolls/policies/period-bonuses/${bonusId}`, data);
  },

  deletePeriodBonus: async (bonusId: number): Promise<{ message: string }> => {
    return api.delete(`/payrolls/policies/period-bonuses/${bonusId}`);
  },

  getWorkingDays: async (period: string): Promise<PayrollPeriodWorkingDays> => {
    return api.get<PayrollPeriodWorkingDays>(`/payrolls/working-days/${period}`);
  },

  overrideWorkingDays: async (period: string, data: { override_working_days: number; reason?: string }): Promise<PayrollPeriodWorkingDays> => {
    return api.post<PayrollPeriodWorkingDays>(`/payrolls/working-days/${period}`, data);
  },

  resetWorkingDays: async (period: string): Promise<PayrollPeriodWorkingDays> => {
    return api.delete<PayrollPeriodWorkingDays>(`/payrolls/working-days/${period}`);
  },

  getHolidays: async (year?: number): Promise<PublicHoliday[]> => {
    return api.get<PublicHoliday[]>('/payrolls/holidays', year ? { year } : undefined);
  },

  createHoliday: async (data: { holiday_date: string; holiday_name: string; notes?: string }): Promise<PublicHoliday> => {
    return api.post<PublicHoliday>('/payrolls/holidays', data);
  },

  updateHoliday: async (holidayId: number, data: { holiday_date?: string; holiday_name?: string; notes?: string }): Promise<PublicHoliday> => {
    return api.put<PublicHoliday>(`/payrolls/holidays/${holidayId}`, data);
  },

  deleteHoliday: async (holidayId: number): Promise<{ message: string }> => {
    return api.delete(`/payrolls/holidays/${holidayId}`);
  },

  getPayslip: async (payrollId: number): Promise<any> => {
    return api.get(`/payrolls/${payrollId}/payslip`);
  },

  adjustDraft: async (payrollId:number, additionAmount:number, deductionAmount:number, reason:string):Promise<any> =>
    api.put(`/payrolls/${payrollId}/adjustments`,{addition_amount:additionAmount,deduction_amount:deductionAmount,reason}),

  updateStatus: async (payrollId: number, paymentStatus: string, paymentDate?: string): Promise<any> => {
    return api.put(`/payrolls/${payrollId}/status`, { payment_status: paymentStatus, payment_date: paymentDate });
  },

  confirmAll: async (period: string): Promise<any> => {
    return api.post('/payrolls/confirm-all', { salary_period: period, payment_status: 'CONFIRMED' });
  },

  payAll: async (period: string, paymentDate?: string): Promise<any> => {
    return api.post('/payrolls/pay-all', { salary_period: period, payment_status: 'PAID', payment_date: paymentDate });
  },

  reopenPeriod: async (period:string,reason:string):Promise<any> =>
    api.post('/payrolls/reopen-period',{salary_period:period,reason}),

  unconfirm: async (payrollId:number,reason:string):Promise<any> =>
    api.post(`/payrolls/${payrollId}/unconfirm`,{reason}),

  getMySales: async (period?: string): Promise<any> => {
    return api.get('/payrolls/sales-records/me', period ? { period } : undefined);
  },

  getMyCommission: async (period?: string): Promise<any> => {
    return api.get('/payrolls/commissions/me', period ? { period } : undefined);
  },

  getExportExcelUrl: (period?: string, storeId?: number): string => {
    const params = new URLSearchParams();
    if (period) params.append('period', period);
    if (storeId) params.append('store_id', String(storeId));
    return `${API_BASE_URL}/payrolls/export/excel?${params.toString()}`;
  },

  exportExcel: async (period: string, storeId?: number): Promise<Blob> => {
    const token = tokenService.get();
    const query = new URLSearchParams({ period });
    if (storeId) query.append('store_id', String(storeId));
    
    const response = await fetch(`${API_BASE_URL}/payrolls/export/excel?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error('Không thể tải file Excel bảng lương');
    return response.blob();
  },

  exportCsv: async (period: string, storeId?: number): Promise<Blob> => {
    const token = tokenService.get();
    const query = new URLSearchParams({ period });
    if (storeId) query.append('store_id', String(storeId));
    
    const response = await fetch(`${API_BASE_URL}/payrolls/export/csv?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error('Không thể tải file CSV bảng lương');
    return response.blob();
  },

  exportAnnualExcel: async (year: string, employeeId?: number, storeId?: number): Promise<Blob> => {
    const token = tokenService.get();
    const query = new URLSearchParams({ year });
    if (employeeId) query.append('employee_id', String(employeeId));
    if (storeId) query.append('store_id', String(storeId));

    const response = await fetch(`${API_BASE_URL}/payrolls/export/annual/excel?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error('Không thể tải file Excel bảng lương năm');
    return response.blob();
  },
};

// ============================================
// Report & Analytics API
// ============================================

export const reportApi = {
  getDashboardStats: async (period?: string, storeId?: number): Promise<any> => {
    const params: Record<string, any> = {};
    if (period) params.period = period;
    if (storeId) params.store_id = storeId;
    return api.get('/reports/dashboard-stats', Object.keys(params).length ? params : undefined);
  },

  getMonthlyStatus: async (): Promise<any> => {
    return api.get('/reports/monthly-status');
  },

  getDemographics: async (storeId?: number, includeResigned: boolean = false): Promise<any> => {
    const params: Record<string, any> = {};
    if (storeId) params.store_id = storeId;
    if (includeResigned) params.include_resigned = true;
    return api.get('/reports/demographics', Object.keys(params).length ? params : undefined);
  },

  getHeadcountTrend: async (months: number = 6): Promise<any> => {
    return api.get('/reports/headcount-trend', { months });
  },

  getPayrollTrend: async (limit: number = 6): Promise<any> => {
    return api.get('/reports/payroll-trend', { limit });
  },

  getAttendanceSummary: async (period?: string, storeId?: number): Promise<any> => {
    const params: Record<string, any> = {};
    if (period) params.period = period;
    if (storeId) params.store_id = storeId;
    return api.get('/reports/attendance-summary', Object.keys(params).length ? params : undefined);
  },

  getLeaveSummary: async (period?: string, storeId?: number): Promise<any> => {
    const params: Record<string, any> = {};
    if (period) params.period = period;
    if (storeId) params.store_id = storeId;
    return api.get('/reports/leave-summary', Object.keys(params).length ? params : undefined);
  },

  getPayrollFund: async (period?: string, storeId?: number): Promise<any> => {
    const params: Record<string, any> = {};
    if (period) params.period = period;
    if (storeId) params.store_id = storeId;
    return api.get('/reports/payroll-fund', Object.keys(params).length ? params : undefined);
  },

  getSalesPerformance: async (params?: { period?: string; store_id?: number }): Promise<any> => {
    return api.get('/reports/sales-performance', params);
  },

  getAuditLogs: async (limit?: number, action?: string): Promise<any[]> => {
    return api.get<any[]>('/reports/audit-logs', { limit: limit || 50, action });
  },

  exportOverviewExcel: async (period?: string, storeId?: number): Promise<Blob> => {
    const token = tokenService.get();
    const params: Record<string, any> = {};
    if (period) params.period = period;
    if (storeId) params.store_id = storeId;
    if (token && token !== 'null' && token !== 'undefined') params.token = token;
    
    return api.getBlob('/reports/export/overview/excel', params);
  },

  exportDemographicsExcel: async (storeId?: number): Promise<Blob> => {
    const token = tokenService.get();
    const params: Record<string, any> = {};
    if (storeId) params.store_id = storeId;
    if (token && token !== 'null' && token !== 'undefined') params.token = token;
    
    return api.getBlob('/reports/export/demographics/excel', params);
  },

  exportPayrollSummaryExcel: async (period?: string): Promise<Blob> => {
    const token = tokenService.get();
    const params: Record<string, any> = {};
    if (period) params.period = period;
    if (token && token !== 'null' && token !== 'undefined') params.token = token;
    
    return api.getBlob('/reports/export/payroll-summary/excel', params);
  },

  getExportDemographicsExcelUrl: (storeId?: number): string => {
    const params = storeId ? `?store_id=${storeId}` : '';
    return `${API_BASE_URL}/reports/export/demographics/excel${params}`;
  },

  getExportPayrollFundExcelUrl: (period?: string): string => {
    const params = period ? `?period=${period}` : '';
    return `${API_BASE_URL}/reports/export/payroll-summary/excel${params}`;
  },
};

export const storeApi = {
  getAll: async (): Promise<any[]> => {
    return api.get<any[]>('/stores');
  },
};



// ============================================
// Role & Permission API
// ============================================

import type {
  Role,
  Permission,
  RBACMatrixItem,
} from '../types';

export const roleApi = {
  getAll: async (): Promise<Role[]> => {
    return api.get<Role[]>('/roles');
  },

  getPermissions: async (): Promise<Permission[]> => {
    return api.get<Permission[]>('/roles/permissions');
  },

  getRbacMatrix: async (): Promise<RBACMatrixItem[]> => {
    return api.get<RBACMatrixItem[]>('/roles/matrix');
  },
};

// ============================================
// User Management API
// ============================================

import type {
  User,
  UserCreate,
  UserUpdate,
} from '../types';

export const userApi = {
  getAll: async (): Promise<User[]> => {
    return api.get<User[]>('/users');
  },

  getById: async (userId: number): Promise<User> => {
    return api.get<User>(`/users/${userId}`);
  },

  create: async (data: UserCreate): Promise<User> => {
    return api.post<User>('/users', data);
  },

  update: async (userId: number, data: UserUpdate): Promise<User> => {
    return api.put<User>(`/users/${userId}`, data);
  },

  resetPassword: async (userId: number, newPassword: string): Promise<{ message: string }> => {
    return api.post(`/users/${userId}/reset-password`, { new_password: newPassword });
  },

  delete: async (userId: number): Promise<{ message: string; action: 'DELETED' | 'DEACTIVATED'; is_active?: boolean }> => {
    return api.delete(`/users/${userId}`);
  },

  updateStatus: async (userId: number, isActive: boolean): Promise<{ message: string; is_active: boolean }> => {
    return api.put(`/users/${userId}/status?is_active=${isActive}`, {});
  },

  updateRoles: async (userId: number, roleIds: number[]): Promise<{ message: string; roles: string[] }> => {
    return api.put(`/users/${userId}/roles`, roleIds);
  },
};

// ============================================
// Audit Log API
// ============================================

import type { AuditLog } from '../types';

export interface AuditLogResponse {
  items: AuditLog[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export const auditApi = {
  getAll: async (params?: {
    page?: number;
    page_size?: number;
    action?: string;
    entity_name?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<AuditLogResponse> => {
    return api.get<AuditLogResponse>('/audit-logs', params);
  },
  getActions: async (): Promise<string[]> => {
    return api.get<string[]>('/audit-logs/actions');
  },
  getEntities: async (): Promise<string[]> => {
    return api.get<string[]>('/audit-logs/entities');
  },
};

// ============================================
// Health Check API
// ============================================

export const healthApi = {
  check: async (): Promise<{
    status: string
    service: string
    database: string
    environment: string
  }> => {
    return api.get('/health');
  },
};

// ============================================
// AI Chatbot API
// ============================================

export interface AIChatbotResponse {
  answer: string;
  sources: string[];
  confidence: number;
  tools_used?: string[];
  action_proposal?: {
    action_type: string;
    title: string;
    description: string;
    payload: any;
    requires_attachment?: boolean;
    attachment_hint?: string;
  };
  requires_action?: boolean;
  thread_id?: string;
}

export interface AIChatbotStreamCallbacks {
  onStart?: (data: { thread_id: string }) => void;
  onStatus?: (message: string) => void;
  onToken?: (token: string) => void;
  onDone?: (data: {
    answer: string;
    sources: string[];
    tools_used: string[];
    action_proposal?: any;
    requires_action?: boolean;
    thread_id: string;
  }) => void;
  onError?: (err: Error) => void;
}

export const aiChatbotApi = {
  query: async (query: string, thread_id?: string): Promise<AIChatbotResponse> => {
    return api.post<AIChatbotResponse>('/ai-chatbot/query', { query, thread_id });
  },

  getHistory: async (thread_id?: string, limit: number = 50): Promise<{ thread_id?: string; messages: any[] }> => {
    return api.get<{ thread_id?: string; messages: any[] }>('/ai-chatbot/history', { thread_id, limit });
  },

  streamQuery: async (
    query: string,
    thread_id: string | undefined,
    callbacks: AIChatbotStreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> => {
    const token = tokenService.get();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token && token !== 'null' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE_URL}/ai-chatbot/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, thread_id }),
      signal,
    });

    if (!res.ok) {
      let errMsg = `Lỗi máy chủ (${res.status})`;
      try {
        const errJson = await res.json();
        errMsg = errJson.detail || errMsg;
      } catch {
        // fallback
      }
      const err = new Error(errMsg);
      callbacks.onError?.(err);
      throw err;
    }

    if (!res.body) {
      throw new Error('ReadableStream không được trình duyệt hỗ trợ.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const block of lines) {
        const trimmed = block.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.event === 'start') {
            callbacks.onStart?.(parsed);
          } else if (parsed.event === 'status') {
            callbacks.onStatus?.(parsed.message || '');
          } else if (parsed.event === 'token') {
            callbacks.onToken?.(parsed.text || '');
          } else if (parsed.event === 'done') {
            callbacks.onDone?.(parsed);
          }
        } catch {
          // ignore parsing error for chunk boundary
        }
      }
    }
  },

  confirmAction: async (data: {
    action_type: string;
    payload: any;
    confirmed: boolean;
    attachment_url?: string;
    thread_id?: string;
  }): Promise<any> => {
    return api.post<any>('/ai-chatbot/confirm-action', data);
  },
};



export default api;
