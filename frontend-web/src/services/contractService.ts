// ============================================
// Contract Management API Service
// ============================================

import api from './api';
import type { Contract, ContractStats, ContractListResponse, ContractType } from '../types/contract';

// ============================================
// Contract Type Definitions
// ============================================

export interface ContractCreateData {
  employee_id: number;
  contract_type: ContractType;
  start_date: string;
  end_date?: string | null;
  basic_salary: number;
  insurance_salary?: number | null;
  signed_date: string;
  position_id?: number | null;
  department_id?: number | null;
  notes?: string | null;
  file_url?: string | null;
}

export interface ContractUpdateData {
  contract_type?: ContractType;
  start_date?: string;
  end_date?: string | null;
  basic_salary?: number;
  insurance_salary?: number;
  signed_date?: string;
  position_id?: number;
  department_id?: number;
  notes?: string;
  file_url?: string;
}

export interface ContractTerminateData {
  termination_date: string;
  termination_reason: string;
  termination_type?: string;
  resignation_id?: number | null;
  document_url?: string | null;
  decision_number?: string | null;
  notes?: string | null;
}

export interface ContractRenewData {
  new_start_date: string;
  new_end_date?: string | null;
  new_basic_salary?: number;
  new_position_id?: number;
  notes?: string;
}

// ============================================
// Contract API
// ============================================

export const contractApi = {
  /**
   * Lấy danh sách hợp đồng với phân trang và bộ lọc
   */
  list: async (params?: {
    status?: string;
    contract_type?: string;
    employee_id?: number;
    store_id?: number;
    department_id?: number;
    position_id?: number;
    expiring_days?: number;
    expired?: boolean;
    search?: string;
    page?: number;
    page_size?: number;
  }): Promise<ContractListResponse> => {
    return api.get<ContractListResponse>('/contracts', params);
  },

  /**
   * Lấy chi tiết một hợp đồng
   */
  get: async (contractId: number): Promise<Contract> => {
    return api.get<Contract>(`/contracts/${contractId}`);
  },

  /**
   * Tạo hợp đồng mới
   */
  create: async (data: ContractCreateData): Promise<{
    message: string;
    contract_id: number;
    contract_number: string;
    status: string;
  }> => {
    return api.post('/contracts', data);
  },

  /**
   * Cập nhật hợp đồng (chỉ DRAFT)
   */
  update: async (contractId: number, data: ContractUpdateData): Promise<{
    message: string;
    contract_id: number;
  }> => {
    return api.put(`/contracts/${contractId}`, data);
  },

  /**
   * Kích hoạt hợp đồng: DRAFT -> ACTIVE
   */
  activate: async (contractId: number): Promise<{
    message: string;
    contract_id: number;
    status: string;
  }> => {
    return api.post(`/contracts/${contractId}/activate`, {});
  },

  /**
   * Gia hạn hợp đồng
   */
  renew: async (contractId: number, data: ContractRenewData): Promise<{
    message: string;
    old_contract_id: number;
    new_contract_id: number;
    new_contract_number: string;
    status: string;
  }> => {
    return api.post(`/contracts/${contractId}/renew`, data);
  },

  /**
   * Chấm dứt hợp đồng: ACTIVE -> TERMINATED
   */
  terminate: async (contractId: number, data: ContractTerminateData): Promise<{
    message: string;
    contract_id: number;
    status: string;
    termination_date: string;
  }> => {
    return api.post(`/contracts/${contractId}/terminate`, data);
  },

  /**
   * Hủy hợp đồng: DRAFT -> CANCELLED
   */
  cancel: async (contractId: number): Promise<{
    message: string;
    contract_id: number;
    status: string;
  }> => {
    return api.post(`/contracts/${contractId}/cancel`, {});
  },

  /**
   * Upload file hợp đồng
   */
  uploadFile: async (contractId: number, file: File): Promise<{
    message: string;
    file_url: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/contracts/${contractId}/file`, formData);
  },

  /**
   * Lấy URL file hợp đồng (tự tạo nếu chưa có)
   */
  getFileUrl: async (contractId: number): Promise<{ file_url: string }> => {
    return api.get(`/contracts/${contractId}/file`);
  },

  /**
   * Tự động sinh/tạo lại file PDF hợp đồng chuẩn
   */
  generatePdf: async (contractId: number): Promise<{
    message: string;
    file_url: string;
  }> => {
    return api.post(`/contracts/${contractId}/generate-pdf`, {});
  },

  /**
   * Lấy lịch sử hợp đồng của một nhân viên
   */
  getEmployeeHistory: async (employeeId: number): Promise<Contract[]> => {
    return api.get<Contract[]>(`/contracts/employee/${employeeId}/history`);
  },

  /**
   * Lấy thống kê dashboard
   */
  getStats: async (): Promise<ContractStats> => {
    return api.get<ContractStats>('/contracts/stats/dashboard');
  },

  /**
   * Upload giấy tờ/quyết định chấm dứt hợp đồng
   */
  uploadTerminationDoc: async (file: File): Promise<{
    message: string;
    file_url: string;
    filename: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.upload('/contracts/upload-termination-document', formData);
  },

  /**
   * Đồng bộ trạng thái nhân viên và tài khoản theo hiệu lực hợp đồng
   */
  syncEmployeeStatuses: async (): Promise<{
    message: string;
    total_checked: number;
    updated_count: number;
    updates: any[];
  }> => {
    return api.post('/contracts/sync-employee-statuses', {});
  },
};

export default contractApi;
