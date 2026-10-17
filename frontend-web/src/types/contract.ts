// ============================================
// Contract Type Definitions
// ============================================

export type ContractType =
  | 'PROBATION'
  | 'FIXED_TERM'
  | 'FIXED_1_YEAR'
  | 'FIXED_2_YEAR'
  | 'FIXED_3_YEAR'
  | 'INDEFINITE'
  | string;

export type ContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'CANCELLED';

export interface Contract {
  contract_id: number;
  contract_number: string;
  employee_id: number;
  employee_code?: string | null;
  employee_name?: string | null;
  contract_type: ContractType;
  start_date: string;
  end_date?: string | null;
  basic_salary?: number | null;
  insurance_salary?: number | null;
  signed_date: string;
  status: ContractStatus;
  notes?: string | null;
  contract_file_url?: string | null;
  previous_contract_id?: number | null;
  previous_contract_number?: string | null;
  position_id?: number | null;
  position_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  termination_date?: string | null;
  termination_reason?: string | null;
  termination_document_url?: string | null;
  created_at?: string | null;
  activated_at?: string | null;
  updated_at?: string | null;
}

export interface ContractStats {
  active: number;
  expiring_soon: number;
  expired: number;
  terminated: number;
  draft: number;
}

export interface ContractListResponse {
  data: Contract[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Status display labels in Vietnamese
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Bản nháp',
  ACTIVE: 'Đang hiệu lực',
  EXPIRED: 'Đã hết hạn',
  TERMINATED: 'Đã chấm dứt',
  CANCELLED: 'Đã hủy',
};

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  PROBATION: 'Thử việc',
  FIXED_TERM: 'Xác định thời hạn',
  FIXED_1_YEAR: 'Xác định thời hạn (1 năm)',
  FIXED_2_YEAR: 'Xác định thời hạn (2 năm)',
  FIXED_3_YEAR: 'Xác định thời hạn (3 năm)',
  INDEFINITE: 'Không xác định thời hạn',
};

export const getContractTypeLabel = (type: string | null | undefined): string => {
  if (!type) return '--';
  if (CONTRACT_TYPE_LABELS[type]) return CONTRACT_TYPE_LABELS[type];
  if (type.startsWith('FIXED_')) return 'Xác định thời hạn';
  return type;
};

// Status badge CSS classes matching Vero design system
export const getContractStatusClass = (status: string | null | undefined): string => {
  switch (status) {
    case 'ACTIVE':
      return 'running';
    case 'DRAFT':
      return 'paused';
    case 'EXPIRED':
    case 'TERMINATED':
      return 'rejected';
    case 'CANCELLED':
      return 'scheduled';
    default:
      return 'scheduled';
  }
};

export const CONTRACT_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-status paused',
  ACTIVE: 'badge-status running',
  EXPIRED: 'badge-status rejected',
  TERMINATED: 'badge-status rejected',
  CANCELLED: 'badge-status scheduled',
};
