// ============================================
// Resignation Management API Service
// ============================================

import api from './api';
import type {
  Resignation,
  ResignationStats,
  ResignationListResponse,
  ResignationCreatePayload,
  ResignationApprovePayload,
  ResignationRejectPayload,
} from '../types/resignation';

export const resignationApi = {
  /**
   * Lấy danh sách đơn thôi việc với phân trang và bộ lọc
   */
  list: async (params?: {
    status?: string;
    employee_id?: number;
    store_id?: number;
    department_id?: number;
    search?: string;
    page?: number;
    page_size?: number;
  }): Promise<ResignationListResponse> => {
    return api.get<ResignationListResponse>('/resignations', params);
  },

  /**
   * Lấy chi tiết đơn thôi việc
   */
  get: async (resignationId: number): Promise<Resignation> => {
    return api.get<Resignation>(`/resignations/${resignationId}`);
  },

  /**
   * Thống kê số lượng đơn thôi việc theo các trạng thái
   */
  getStats: async (): Promise<ResignationStats> => {
    return api.get<ResignationStats>('/resignations/stats');
  },

  /**
   * Lấy danh sách hợp đồng đang ACTIVE của nhân viên để chọn khi tạo đơn
   */
  getEmployeeActiveContracts: async (employeeId: number): Promise<any[]> => {
    return api.get<any[]>(`/resignations/employee-active-contracts/${employeeId}`);
  },

  /**
   * HR tạo đơn thôi việc cho nhân viên
   */
  create: async (data: ResignationCreatePayload): Promise<{
    message: string;
    resignation_id: number;
    status: string;
  }> => {
    return api.post('/resignations', data);
  },

  /**
   * Duyệt đơn thôi việc (chốt ngày làm việc cuối cùng)
   */
  approve: async (resignationId: number, data: ResignationApprovePayload): Promise<{
    message: string;
    resignation_id: number;
    status: string;
    approved_last_working_date: string;
  }> => {
    return api.post(`/resignations/${resignationId}/approve`, data);
  },

  /**
   * Từ chối đơn thôi việc
   */
  reject: async (resignationId: number, data: ResignationRejectPayload): Promise<{
    message: string;
    resignation_id: number;
    status: string;
  }> => {
    return api.post(`/resignations/${resignationId}/reject`, data);
  },

  /**
   * Hủy đơn thôi việc
   */
  cancel: async (resignationId: number): Promise<{
    message: string;
    resignation_id: number;
    status: string;
  }> => {
    return api.post(`/resignations/${resignationId}/cancel`, {});
  },

  /**
   * Tải file đính kèm đơn thôi việc (đơn scan/PDF)
   */
  uploadAttachment: async (file: File): Promise<{
    message: string;
    file_url: string;
    filename: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.upload('/resignations/upload-attachment', formData);
  },
};
