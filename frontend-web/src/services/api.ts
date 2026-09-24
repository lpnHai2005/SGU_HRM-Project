// ============================================
// API Configuration
// ============================================

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

// ============================================
// Token Management
// ============================================

const TOKEN_KEY = 'hrm_token';
const USER_KEY = 'hrm_user';

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

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const token = tokenService.get();
    if (token) {
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

    const config: RequestInit = {
      ...fetchOptions,
      headers: {
        ...this.getHeaders(),
        ...fetchOptions.headers,
      },
    };

    try {
      const response = await fetch(url, config);

      // Handle 401 Unauthorized
      if (response.status === 401) {
        clearAuth();
        window.location.href = '/login';
        throw new Error('Phiên đăng nhập đã hết hạn');
      }

      // Handle other errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Yêu cầu thất bại (${response.status})`);
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
    });

    return response;
  },

  getMe: async (): Promise<UserProfile> => {
    return api.get<UserProfile>('/auth/me');
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
  Lookups,
} from '../types';

export const employeeApi = {
  getAll: async (params?: {
    store_id?: number
    department_id?: number
    status?: string
    search?: string
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

  getLookups: async (): Promise<Lookups> => {
    return api.get<Lookups>('/employees/metadata/lookups');
  },
};

// ============================================
// Attendance API
// ============================================

import type {
  Attendance,
  CheckInRequest,
  CheckOutRequest,
  CheckInResponse,
  ShiftSchedule,
  ShiftScheduleCreate,
} from '../types';

export const attendanceApi = {
  getAll: async (params?: {
    work_date?: string
    store_id?: number
  }): Promise<Attendance[]> => {
    return api.get<Attendance[]>('/attendances', params);
  },

  getMyHistory: async (period?: string): Promise<Attendance[]> => {
    return api.get<Attendance[]>('/attendances/my-history', period ? { period } : undefined);
  },

  checkIn: async (data?: CheckInRequest): Promise<CheckInResponse> => {
    return api.post<CheckInResponse>('/attendances/check-in', data || {});
  },

  checkOut: async (data: CheckOutRequest): Promise<{ message: string; actual_hours: number; overtime_hours: number }> => {
    return api.post('/attendances/check-out', data);
  },

  getShiftSchedules: async (params?: {
    store_id?: number
    work_date?: string
  }): Promise<ShiftSchedule[]> => {
    return api.get<ShiftSchedule[]>('/attendances/shift-schedules', params);
  },

  assignShiftSchedule: async (data: ShiftScheduleCreate): Promise<{ message: string }> => {
    return api.post('/attendances/shift-schedules', data);
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

  getAll: async (params?: { status?: string }): Promise<LeaveRequest[]> => {
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
};

// ============================================
// Payroll API
// ============================================

import type {
  Payroll,
  SalesRecordCreate,
} from '../types';

export const payrollApi = {
  getAll: async (params?: {
    period?: string
    employee_id?: number
  }): Promise<Payroll[]> => {
    return api.get<Payroll[]>('/payrolls', params);
  },

  getById: async (payrollId: number): Promise<Payroll> => {
    return api.get<Payroll>(`/payrolls/${payrollId}`);
  },

  calculate: async (period: string): Promise<{ message: string; salary_period: string }> => {
    return api.post('/payrolls/calculate', { salary_period: period });
  },

  generate: async (month: string): Promise<Payroll[]> => {
    return api.post<Payroll[]>(`/payrolls/generate/${month}`);
  },

  getAnnualSummary: async (
    employeeId: number,
    year?: string
  ): Promise<any> => {
    return api.get(`/payrolls/annual-summary/${employeeId}`, year ? { year } : undefined);
  },

  recordSales: async (data: SalesRecordCreate): Promise<{ message: string }> => {
    return api.post('/payrolls/sales-records', data);
  },

  getCommissions: async (month: string): Promise<any[]> => {
    return api.get(`/payrolls/commissions/calculate/${month}`);
  },

  getProjects: async (): Promise<any[]> => {
    return api.get('/payrolls/projects/list');
  },

  getPayslip: async (payrollId: number): Promise<any> => {
    return api.get(`/payrolls/${payrollId}/payslip`);
  },

  updateStatus: async (payrollId: number, paymentStatus: string): Promise<any> => {
    return api.put(`/payrolls/${payrollId}/status`, { payment_status: paymentStatus });
  },

  confirmAll: async (period: string): Promise<any> => {
    return api.post('/payrolls/confirm-all', { salary_period: period, payment_status: 'CONFIRMED' });
  },

  payAll: async (period: string): Promise<any> => {
    return api.post('/payrolls/pay-all', { salary_period: period, payment_status: 'PAID' });
  },

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
};

// ============================================
// Report & Analytics API
// ============================================

export const reportApi = {
  getDashboardStats: async (period?: string): Promise<any> => {
    return api.get('/reports/dashboard-stats', period ? { period } : undefined);
  },

  getMonthlyStatus: async (): Promise<any> => {
    return api.get('/reports/monthly-status');
  },

  getDemographics: async (storeId?: number): Promise<any> => {
    return api.get('/reports/demographics', storeId ? { store_id: storeId } : undefined);
  },

  getPayrollFund: async (period?: string): Promise<any> => {
    return api.get('/reports/payroll-fund', period ? { period } : undefined);
  },

  getSalesPerformance: async (params?: { period?: string; store_id?: number }): Promise<any> => {
    return api.get('/reports/sales-performance', params);
  },

  getAuditLogs: async (limit?: number, action?: string): Promise<any[]> => {
    return api.get<any[]>('/reports/audit-logs', { limit: limit || 50, action });
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

  updateStatus: async (userId: number, isActive: boolean): Promise<{ message: string; is_active: boolean }> => {
    return api.put(`/users/${userId}/status`, { is_active: isActive });
  },

  updateRoles: async (userId: number, roleIds: number[]): Promise<{ message: string; roles: string[] }> => {
    return api.put(`/users/${userId}/roles`, roleIds);
  },
};

// ============================================
// Audit Log API
// ============================================

import type { AuditLog } from '../types';

export const auditApi = {
  getAll: async (params?: {
    limit?: number
    action?: string
    entity_name?: string
  }): Promise<AuditLog[]> => {
    return api.get<AuditLog[]>('/audit-logs', params);
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

export default api;
