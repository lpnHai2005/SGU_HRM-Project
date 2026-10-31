import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
} from 'recharts'

import { StatCard } from '../components/common/StatCard'
import { MonthPicker } from '../components/common/MonthPicker'
import {
  reportApi,
  storeApi,
  payrollApi,
} from '../services/api'
import {
  CHART_COLORS,
  PALETTE_CATEGORIES,
  formatChartCurrency,
  formatFullCurrency,
  formatChartNumber,
} from '../components/charts/chartTheme'
import { CustomChartTooltip } from '../components/charts/CustomChartTooltip'
import { ReportsPrintModal } from './ReportsPrintModal'
import { ReportDrilldownModal } from '../components/reports/ReportDrilldownModal'
import type { DrilldownColumn } from '../components/reports/ReportDrilldownModal'
import { evaluateAdvancedSearch } from '../components/common/AdvancedSearchModal'
import type { SearchCondition, SearchFieldConfig } from '../components/common/AdvancedSearchModal'
import { Filter, Eye, Table as TableIcon, Building2, User as UserIcon, Calendar, DollarSign, Trash2 } from 'lucide-react'
import type {
  DemographicsReportData,
  HeadcountTrendPoint,
  PayrollTrendPoint,
  AttendanceSummaryData,
  LeaveSummaryData,
  SalesPerformanceReportData,
  HRStatusReportData,
} from '../types'

import './ReportsPage.css'

export interface ReportsPageProps {
  user: any
}

// Phạm vi dự án HRM: Cơ cấu nhân sự, Quỹ lương, Chấm công và Bảng Ma trận Thống kê Quý/Năm
type ReportTab = 'demographics' | 'payroll' | 'attendance' | 'matrix'

// 1. Bộ lọc cho Biểu đồ Thâm niên công tác ("Thâm niên gắn bó với TechZone")
const SENIORITY_FILTER_FIELDS: SearchFieldConfig[] = [
  { key: 'seniority_years', label: 'Số năm công tác', type: 'number', placeholder: 'vd: 2' },
  { key: 'seniority_group', label: 'Khoảng thâm niên', type: 'select', placeholder: 'Chọn khoảng thâm niên...' },
  { key: 'position_name', label: 'Chức vụ', type: 'select', placeholder: 'Chọn chức vụ...' },
  { key: 'store_name', label: 'Cơ sở / Chi nhánh', type: 'select', placeholder: 'Chọn chi nhánh...' },
  { key: 'full_name', label: 'Họ và tên nhân sự', type: 'string', placeholder: 'Họ tên nhân viên...' },
  { key: 'employee_code', label: 'Mã NV', type: 'string', placeholder: 'TZ-...' },
  { key: 'basic_salary', label: 'Lương thỏa thuận HĐ', type: 'number', placeholder: 'vd: 10000000' },
  { key: 'join_date', label: 'Ngày vào làm', type: 'date' },
]

// 2. Bộ lọc cho Biểu đồ Trình độ học vấn ("Cơ cấu trình độ học vấn")
const EDUCATION_FILTER_FIELDS: SearchFieldConfig[] = [
  { key: 'education_level', label: 'Trình độ học vấn', type: 'select', placeholder: 'Chọn trình độ học vấn...' },
  { key: 'position_name', label: 'Chức vụ', type: 'select', placeholder: 'Chọn chức vụ...' },
  { key: 'store_name', label: 'Cơ sở / Chi nhánh', type: 'select', placeholder: 'Chọn chi nhánh...' },
  { key: 'full_name', label: 'Họ và tên nhân sự', type: 'string', placeholder: 'Họ tên nhân viên...' },
  { key: 'employee_code', label: 'Mã NV', type: 'string', placeholder: 'TZ-...' },
  { key: 'seniority_years', label: 'Thâm niên (năm)', type: 'number', placeholder: 'vd: 3' },
  { key: 'basic_salary', label: 'Lương thỏa thuận HĐ', type: 'number', placeholder: 'vd: 10000000' },
]

// 3. Bộ lọc cho Biểu đồ Mức lương hợp đồng ("Phân khúc mức lương thỏa thuận theo HĐ")
const SALARY_BRACKET_FILTER_FIELDS: SearchFieldConfig[] = [
  { key: 'salary_bracket', label: 'Khung mức lương', type: 'select', placeholder: 'Chọn khung lương...' },
  { key: 'basic_salary', label: 'Lương cơ bản HĐ', type: 'number', placeholder: 'vd: 10000000' },
  { key: 'position_name', label: 'Chức vụ', type: 'select', placeholder: 'Chọn chức vụ...' },
  { key: 'store_name', label: 'Cơ sở / Chi nhánh', type: 'select', placeholder: 'Chọn chi nhánh...' },
  { key: 'full_name', label: 'Họ và tên nhân sự', type: 'string', placeholder: 'Họ tên nhân viên...' },
  { key: 'employee_code', label: 'Mã NV', type: 'string', placeholder: 'TZ-...' },
  { key: 'seniority_years', label: 'Thâm niên (năm)', type: 'number', placeholder: 'vd: 2' },
]

// 4. Bộ lọc cho Nhân sự chung & Phân bổ theo Cơ sở ("EMPLOYEE_FILTER_FIELDS")
const EMPLOYEE_FILTER_FIELDS: SearchFieldConfig[] = [
  { key: 'store_name', label: 'Cơ sở / Chi nhánh', type: 'select', placeholder: 'Chọn cửa hàng...' },
  { key: 'position_name', label: 'Chức vụ', type: 'select', placeholder: 'Chọn chức vụ...' },
  { key: 'education_level', label: 'Trình độ học vấn', type: 'select', placeholder: 'Chọn học vấn...' },
  { key: 'full_name', label: 'Họ và tên', type: 'string', placeholder: 'Họ tên nhân viên...' },
  { key: 'employee_code', label: 'Mã NV', type: 'string', placeholder: 'TZ-...' },
  { key: 'seniority_years', label: 'Thâm niên (năm)', type: 'number', placeholder: 'vd: 2' },
  { key: 'basic_salary', label: 'Lương HĐ', type: 'number', placeholder: 'vd: 10000000' },
  { key: 'join_date', label: 'Ngày vào làm', type: 'date' },
]

// 5. Bộ lọc Nghỉ phép ("LEAVE_FILTER_FIELDS")
const LEAVE_FILTER_FIELDS: SearchFieldConfig[] = [
  { key: 'type_name', label: 'Loại nghỉ phép', type: 'select', placeholder: 'Chọn loại nghỉ...' },
  { key: 'status_label', label: 'Trạng thái duyệt', type: 'select', placeholder: 'Chọn trạng thái...' },
  { key: 'store_name', label: 'Cơ sở / Chi nhánh', type: 'select', placeholder: 'Chọn cơ sở...' },
  { key: 'total_days', label: 'Số ngày nghỉ phép', type: 'number', placeholder: 'vd: 3' },
  { key: 'employee_name', label: 'Họ và tên nhân sự', type: 'string', placeholder: 'Tên nhân sự...' },
  { key: 'employee_code', label: 'Mã NV', type: 'string', placeholder: 'TZ-...' },
  { key: 'start_date', label: 'Ngày bắt đầu nghỉ', type: 'date' },
  { key: 'end_date', label: 'Ngày kết thúc nghỉ', type: 'date' },
  { key: 'reason', label: 'Lý do xin nghỉ', type: 'string', placeholder: 'Lý do...' },
]

// 6. Bộ lọc Chấm công ("ATTENDANCE_FILTER_FIELDS")
const ATTENDANCE_FILTER_FIELDS: SearchFieldConfig[] = [
  { key: 'status_label', label: 'Trạng thái chấm công', type: 'select', placeholder: 'Chọn trạng thái...' },
  { key: 'store_name', label: 'Cơ sở / Chi nhánh', type: 'select', placeholder: 'Chọn cơ sở...' },
  { key: 'late_minutes', label: 'Số phút đi muộn', type: 'number', placeholder: 'vd: 15' },
  { key: 'early_minutes', label: 'Số phút về sớm', type: 'number', placeholder: 'vd: 10' },
  { key: 'actual_work_hours', label: 'Giờ làm thực tế', type: 'number', placeholder: 'vd: 8' },
  { key: 'overtime_hours', label: 'Giờ tăng ca (OT)', type: 'number', placeholder: 'vd: 2' },
  { key: 'work_date', label: 'Ngày công', type: 'date' },
  { key: 'employee_name', label: 'Họ và tên nhân sự', type: 'string', placeholder: 'Tên nhân sự...' },
  { key: 'employee_code', label: 'Mã NV', type: 'string', placeholder: 'TZ-...' },
]

// 7. Bộ lọc Quỹ lương ("PAYROLL_FILTER_FIELDS")
const PAYROLL_FILTER_FIELDS: SearchFieldConfig[] = [
  { key: 'payment_status', label: 'Trạng thái thanh toán', type: 'select', placeholder: 'Chọn trạng thái...' },
  { key: 'store_name', label: 'Cơ sở / Chi nhánh', type: 'select', placeholder: 'Chọn chi nhánh...' },
  { key: 'gross_income', label: 'Tổng thu nhập Gross', type: 'number', placeholder: 'vd: 15000000' },
  { key: 'net_salary', label: 'Thực lĩnh Net', type: 'number', placeholder: 'vd: 12000000' },
  { key: 'contract_salary', label: 'Lương thỏa thuận HĐ', type: 'number', placeholder: 'vd: 10000000' },
  { key: 'actual_working_days', label: 'Số ngày công thực tế', type: 'number', placeholder: 'vd: 22' },
  { key: 'total_allowances', label: 'Tổng tiền phụ cấp', type: 'number', placeholder: 'vd: 1000000' },
  { key: 'bonus_amount', label: 'Tiền khen thưởng', type: 'number', placeholder: 'vd: 2000000' },
  { key: 'total_insurance', label: 'Trích nộp BHXH', type: 'number', placeholder: 'vd: 800000' },
  { key: 'employee_name', label: 'Họ và tên nhân sự', type: 'string', placeholder: 'Tên nhân sự...' },
  { key: 'employee_code', label: 'Mã NV', type: 'string', placeholder: 'TZ-...' },
]

const PAYROLL_DRILLDOWN_COLUMNS: DrilldownColumn[] = [
  {
    key: 'employee_name',
    title: 'Nhân viên',
    render: (r: any) => (
      <div>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.employee_name}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code} • {r.store_name}</div>
      </div>
    ),
  },
  { key: 'salary_period', title: 'Kỳ lương', align: 'center' },
  {
    key: 'actual_working_days',
    title: 'Ngày công',
    align: 'center',
    render: (r: any) => <span>{r.actual_working_days ?? '—'}</span>,
  },
  {
    key: 'gross_income',
    title: 'Tổng Gross',
    align: 'right',
    render: (r: any) => (
      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: CHART_COLORS.primary }}>
        {formatFullCurrency(r.gross_income || 0)}
      </span>
    ),
  },
  {
    key: 'net_salary',
    title: 'Thực lĩnh Net',
    align: 'right',
    render: (r: any) => (
      <span style={{ fontFamily: 'monospace', fontWeight: 800, color: CHART_COLORS.success }}>
        {formatFullCurrency(r.net_salary || 0)}
      </span>
    ),
  },
  {
    key: 'payment_status',
    title: 'Trạng thái',
    align: 'center',
    render: (r: any) => (
      <span
        className={`badge ${
          r.payment_status === 'PAID'
            ? 'badge-success'
            : r.payment_status === 'CONFIRMED'
            ? 'badge-primary'
            : 'badge-warning'
        }`}
        style={{ fontSize: '11px' }}
      >
        {r.payment_status === 'PAID' ? 'Đã chi trả' : r.payment_status === 'CONFIRMED' ? 'Đã duyệt' : 'Bản nháp'}
      </span>
    ),
  },
]

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export function ReportsPage({ user }: ReportsPageProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>('demographics')
  // Mặc định lấy kỳ là tháng hiện tại khi mở trang
  const [period, setPeriod] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [stores, setStores] = useState<any[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<number | undefined>(undefined)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false)
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false)

  // Ổn định Animation biểu đồ: Chỉ chạy hiệu ứng lần đầu khi load (900ms), sau đó giữ nguyên trạng thái
  // để khi click vào không bị giật nhấp nháy hay reset ẩn hiện nhãn (ví dụ tspan Đi muộn)
  const [isChartAnimated, setIsChartAnimated] = useState<boolean>(true)
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsChartAnimated(false)
    }, 900)
    return () => clearTimeout(timer)
  }, [])

  // State quản lý Giao diện Main - Subform (Master - Detail side-by-side)
  const [isSubformOpen, setIsSubformOpen] = useState<boolean>(false)
  const [isClosingSubform, setIsClosingSubform] = useState<boolean>(false)
  const [subformConfig, setSubformConfig] = useState<{
    title: string;
    subtitle?: string;
    tag?: string;
    columns: DrilldownColumn[];
    data: any[];
    filterFields: SearchFieldConfig[];
  }>({
    title: '',
    columns: [],
    data: [],
    filterFields: [],
  })
  const [subformSearch, setSubformSearch] = useState<string>('')
  const [subformConditions, setSubformConditions] = useState<SearchCondition[]>([])
  // Thay vì mở popup modal, dùng inline accordion mở trực tiếp trong Subform
  const [isAdvFilterExpanded, setIsAdvFilterExpanded] = useState<boolean>(false)

  // State quản lý Tab 4: Bảng Thống Kê Ma Trận Đa Chiều (Cross-Tab Matrix Reports)
  const [matrixYear, setMatrixYear] = useState<number>(() => new Date().getFullYear())
  const [matrixViewMode, setMatrixViewMode] = useState<'payroll' | 'store' | 'employee'>('payroll')
  const [matrixPayroll, setMatrixPayroll] = useState<any>(null)
  const [matrixByStore, setMatrixByStore] = useState<any>(null)
  const [matrixByEmployee, setMatrixByEmployee] = useState<any>(null)
  const [isLoadingMatrix, setIsLoadingMatrix] = useState<boolean>(false)
  // Bộ nhớ đệm bảng lương theo kỳ để mở Subform siêu tốc (0ms) và tránh gọi API / toast lặp lại
  const payrollsCacheRef = useRef<Record<string, any[]>>({})

  const openSubform = (config: {
    title: string;
    subtitle?: string;
    tag?: string;
    columns: DrilldownColumn[];
    data: any[];
    filterFields?: SearchFieldConfig[];
  }) => {
    setSubformConfig({
      title: config.title,
      subtitle: config.subtitle,
      tag: config.tag,
      columns: config.columns,
      data: config.data || [],
      filterFields: config.filterFields || EMPLOYEE_FILTER_FIELDS,
    })
    setSubformSearch('')
    setSubformConditions([])
    setIsClosingSubform(false)
    setIsSubformOpen(true)
  }

  const closeSubform = () => {
    setIsClosingSubform(true)
    setTimeout(() => {
      setIsSubformOpen(false)
      setIsClosingSubform(false)
    }, 220)
  }

  // Helper lấy nhãn toán tử thân thiện cho người dùng thông thường (không dùng thuật ngữ coder)
  const getFriendlyOperatorsForType = (type: string) => {
    switch (type) {
      case 'number':
        return [
          { label: 'Bằng chính xác ( = )', value: '=' },
          { label: 'Khác ( != )', value: '!=' },
          { label: 'Lớn hơn ( > )', value: '>' },
          { label: 'Nhỏ hơn ( < )', value: '<' },
          { label: 'Từ mức này trở lên ( >= )', value: '>=' },
          { label: 'Từ mức này trở xuống ( <= )', value: '<=' },
        ]
      case 'date':
        return [
          { label: 'Vào đúng ngày ( = )', value: '=' },
          { label: 'Khác ngày ( != )', value: '!=' },
          { label: 'Sau ngày ( > )', value: '>' },
          { label: 'Trước ngày ( < )', value: '<' },
          { label: 'Từ ngày này trở đi ( >= )', value: '>=' },
          { label: 'Đến ngày này ( <= )', value: '<=' },
        ]
      case 'select':
        return [
          { label: 'Chính xác là ( = )', value: '=' },
          { label: 'Không phải là / Khác ( != )', value: '!=' },
          { label: 'Có chứa từ khóa', value: 'CONTAINS' },
        ]
      case 'string':
      default:
        return [
          { label: 'Có chứa từ khóa', value: 'CONTAINS' },
          { label: 'Không chứa từ khóa', value: 'NOT_CONTAINS' },
          { label: 'Chính xác là ( = )', value: '=' },
          { label: 'Khác với ( != )', value: '!=' },
          { label: 'Bắt đầu bằng', value: 'STARTS_WITH' },
          { label: 'Kết thúc bằng', value: 'ENDS_WITH' },
        ]
    }
  }

  // Tự động trích xuất các lựa chọn thực tế cho trường đang chọn (hỗ trợ lấy danh sách chi nhánh đầy đủ từ DB)
  const getOptionsForField = useCallback((fieldKey: string): { label: string; value: string; count: number }[] => {
    const data = subformConfig.data || []

    // 1. Nếu là Cơ sở / Chi nhánh (store_name): Lấy toàn bộ danh sách chi nhánh trong DB (stores state)
    if (fieldKey === 'store_name') {
      const counts = new Map<string, number>()
      data.forEach((row: any) => {
        const val = row.store_name
        if (val) {
          const strVal = String(val).trim()
          counts.set(strVal, (counts.get(strVal) || 0) + 1)
        }
      })

      const storeMap = new Map<string, { label: string; value: string; count: number }>()

      // Đưa các cửa hàng từ DB vào danh sách
      stores.forEach((st: any) => {
        const sName = st.store_name || ''
        if (sName) {
          const count = counts.get(sName) || 0
          storeMap.set(sName, {
            label: count > 0 ? `${sName} (${count})` : `${sName} (0)`,
            value: sName,
            count,
          })
        }
      })

      // Đưa các cơ sở khác có trong data mà chưa có trong stores (ví dụ: 'Văn phòng chính')
      counts.forEach((count, sName) => {
        if (!storeMap.has(sName)) {
          storeMap.set(sName, {
            label: `${sName} (${count})`,
            value: sName,
            count,
          })
        }
      })

      return Array.from(storeMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return a.label.localeCompare(b.label, 'vi')
      })
    }

    if (data.length === 0) return []

    const counts = new Map<string, number>()

    data.forEach((row: any) => {
      const val = row[fieldKey]
      if (val !== undefined && val !== null) {
        const strVal = String(val).trim()
        if (strVal && strVal !== '—' && strVal !== 'undefined' && strVal !== 'null') {
          counts.set(strVal, (counts.get(strVal) || 0) + 1)
        }
      }
    })

    const options: { label: string; value: string; count: number }[] = []
    counts.forEach((count, val) => {
      let displayLabel = val
      if (fieldKey === 'payment_status') {
        if (val === 'PAID') displayLabel = 'Đã chi trả'
        else if (val === 'CONFIRMED') displayLabel = 'Đã duyệt'
        else if (val === 'DRAFT') displayLabel = 'Bản nháp'
      }
      options.push({
        label: `${displayLabel} (${count})`,
        value: val,
        count,
      })
    })

    return options.sort((a, b) => b.count - a.count)
  }, [subformConfig.data, stores])

  // Trợ giúp lọc nhanh theo Dropdown danh mục
  const handleQuickDropdownFilter = (fieldKey: string, value: string) => {
    if (!value) {
      setSubformConditions((prev) => prev.filter((c) => c.fieldKey !== fieldKey))
    } else {
      setSubformConditions((prev) => {
        const withoutField = prev.filter((c) => c.fieldKey !== fieldKey)
        const newCond: SearchCondition = {
          id: `quick_dd_${fieldKey}_${Date.now()}`,
          logic: 'AND',
          isNot: false,
          fieldKey,
          operator: '=',
          value,
        }
        return [...withoutField, newCond]
      })
    }
  }

  const getActiveFilterValue = (fieldKey: string): string => {
    const found = subformConditions.find((c) => c.fieldKey === fieldKey && c.operator === '=' && !c.isNot)
    return found ? found.value : ''
  }

  const handleAddInlineCondition = () => {
    const firstField = subformConfig.filterFields[0]
    const newOp = firstField?.type === 'number'
      ? '>='
      : firstField?.type === 'date'
      ? '>='
      : firstField?.type === 'select'
      ? '='
      : 'CONTAINS'
    const newCond: SearchCondition = {
      id: `cond_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      logic: 'AND',
      isNot: false,
      fieldKey: firstField?.key || '',
      operator: newOp as any,
      value: '',
    }
    setSubformConditions(prev => [...prev, newCond])
  }

  const handleUpdateInlineCondition = (index: number, patch: Partial<SearchCondition>) => {
    setSubformConditions(prev => prev.map((cond, idx) => idx === index ? { ...cond, ...patch } : cond))
  }

  const handleInlineFieldChange = (index: number, newFieldKey: string) => {
    const targetField = subformConfig.filterFields.find(f => f.key === newFieldKey)
    const newOp = targetField?.type === 'number'
      ? '>='
      : targetField?.type === 'date'
      ? '>='
      : targetField?.type === 'select'
      ? '='
      : 'CONTAINS'
    setSubformConditions(prev => prev.map((cond, idx) => idx === index ? {
      ...cond,
      fieldKey: newFieldKey,
      operator: newOp as any,
      value: '',
    } : cond))
  }

  const handleRemoveInlineCondition = (index: number) => {
    setSubformConditions(prev => prev.filter((_, idx) => idx !== index))
  }

  // Tải file CSV/Excel thực tế khi nhấn Xuất dữ liệu ở Subform
  const handleExportSubformData = () => {
    if (!filteredSubformData || filteredSubformData.length === 0) {
      toast.warning('Không có bản ghi nào để xuất file.')
      return
    }

    const headers = ['STT', ...subformConfig.columns.map((c) => c.title || c.key)]
    const rows = filteredSubformData.map((row, idx) => {
      const colValues = subformConfig.columns.map((col) => {
        let val = row[col.key]
        if (val === undefined || val === null) val = ''
        if (typeof val === 'number') return val
        return `"${String(val).replace(/"/g, '""')}"`
      })
      return [idx + 1, ...colValues].join(',')
    })

    const csvContent = '\uFEFF' + [headers.map((h) => `"${h}"`).join(','), ...rows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const sanitizedTitle = (subformConfig.title || 'Du_Lieu_Chi_Tiet')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
    triggerBlobDownload(blob, `${sanitizedTitle}_${period}.csv`)
    toast.success(`Đã xuất thành công ${filteredSubformData.length} bản ghi sang file CSV/Excel!`)
  }

  // Xử lý Drilldown khi nhấp vào Biểu đồ Xu hướng quỹ lương
  const handlePayrollTrendClick = async (chartEvent: any) => {
    // Recharts ComposedChart click event có thể là activeLabel, hoặc trong activePayload, hoặc trên Bar entry
    const clickedPeriod =
      chartEvent?.activeLabel ||
      chartEvent?.period ||
      chartEvent?.payload?.period ||
      chartEvent?.activePayload?.[0]?.payload?.period ||
      chartEvent?.activePayload?.[0]?.payload?.month ||
      (typeof chartEvent === 'string' ? chartEvent : null)

    if (!clickedPeriod) return

    const cacheKey = `${clickedPeriod}_${selectedStoreId || 'all'}`
    let payrolls = payrollsCacheRef.current[cacheKey]

    if (!payrolls) {
      try {
        payrolls = await payrollApi.getAll({ period: clickedPeriod, store_id: selectedStoreId })
        payrollsCacheRef.current[cacheKey] = payrolls || []
      } catch (err: any) {
        console.warn('Lỗi tải chi tiết bảng lương kỳ:', err)
        payrolls = []
      }
    }

    openSubform({
      title: `Chi tiết bảng lương: Kỳ ${clickedPeriod}`,
      subtitle: payrolls && payrolls.length > 0 
        ? `Ghi nhận ${payrolls.length} nhân sự | Tổng quỹ lương: ${formatFullCurrency(payrolls.reduce((sum: number, p: any) => sum + (p.gross_income || 0), 0))}`
        : `Kỳ ${clickedPeriod} chưa phát sinh bảng lương hoặc chưa được chốt lương.`,
      tag: 'Quỹ lương kỳ',
      filterFields: PAYROLL_FILTER_FIELDS,
      columns: PAYROLL_DRILLDOWN_COLUMNS,
      data: payrolls || [],
    })
  }

  // Xử lý Drilldown khi nhấp vào Biểu đồ Cơ cấu quỹ lương tháng
  const handlePayrollBreakdownClick = async (entry: any) => {
    const sliceName = entry?.name || entry?.payload?.name
    if (!sliceName) return

    const cacheKey = `${period}_${selectedStoreId || 'all'}`
    let payrolls = payrollsCacheRef.current[cacheKey]

    if (!payrolls) {
      try {
        payrolls = await payrollApi.getAll({ period, store_id: selectedStoreId })
        payrollsCacheRef.current[cacheKey] = payrolls || []
      } catch (err: any) {
        console.warn('Lỗi tải chi tiết cấu phần lương:', err)
        payrolls = []
      }
    }

    let sorted = [...(payrolls || [])]
    if (sliceName.includes('phụ cấp') || sliceName.includes('Phụ cấp')) {
      sorted.sort((a, b) => (b.total_allowances || 0) - (a.total_allowances || 0))
    } else if (sliceName.includes('Thưởng') || sliceName.includes('hoa hồng')) {
      sorted.sort((a, b) => ((b.bonus_amount || 0) + (b.commission_amount || 0)) - ((a.bonus_amount || 0) + (a.commission_amount || 0)))
    } else if (sliceName.includes('Bảo hiểm')) {
      sorted.sort((a, b) => (b.total_insurance || 0) - (a.total_insurance || 0))
    } else {
      sorted.sort((a, b) => (b.gross_income || 0) - (a.gross_income || 0))
    }

    openSubform({
      title: `Chi tiết cơ cấu: ${sliceName}`,
      subtitle: `Kỳ ${period} - Tổng giá trị: ${formatFullCurrency(entry?.value || 0)} (${sorted.length} nhân sự)`,
      tag: 'Cơ cấu lương',
      filterFields: PAYROLL_FILTER_FIELDS,
      columns: PAYROLL_DRILLDOWN_COLUMNS,
      data: sorted,
    })
  }

  // Lọc dữ liệu hiển thị trong Subform: Kết hợp Search nhanh + Tìm kiếm nâng cao (>, <, =, AND, OR, NOT)
  const filteredSubformData = useMemo(() => {
    let result = subformConfig.data || []
    if (subformSearch.trim()) {
      const term = subformSearch.toLowerCase().trim()
      result = result.filter((row: any) =>
        Object.values(row).some((val) => String(val || '').toLowerCase().includes(term))
      )
    }
    if (subformConditions.length > 0) {
      result = result.filter((row: any) =>
        evaluateAdvancedSearch(row, subformConditions, subformConfig.filterFields)
      )
    }
    return result
  }, [subformConfig.data, subformSearch, subformConditions, subformConfig.filterFields])

  // Backward compatibility cho print modal
  const [drilldownConfig, setDrilldownConfig] = useState<any>({ isOpen: false, title: '', columns: [], data: [] })

  // Dữ liệu cho các tabs
  const [dashboardStats, setDashboardStats] = useState<any>(null)
  const [monthlyStatus, setMonthlyStatus] = useState<HRStatusReportData[]>([])
  const [demographics, setDemographics] = useState<DemographicsReportData | null>(null)
  const [headcountTrend, setHeadcountTrend] = useState<HeadcountTrendPoint[]>([])
  const [payrollTrend, setPayrollTrend] = useState<PayrollTrendPoint[]>([])
  const [payrollFund, setPayrollFund] = useState<any>(null)
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummaryData | null>(null)
  const [leaveSummary, setLeaveSummary] = useState<LeaveSummaryData | null>(null)
  const [salesReport, setSalesReport] = useState<SalesPerformanceReportData | null>(null)

  // Tải danh sách cửa hàng một lần
  useEffect(() => {
    storeApi.getAll()
      .then((data: any[]) => setStores(data || []))
      .catch((err: any) => console.warn('Không thể tải danh sách cửa hàng:', err))
  }, [])

  // Tải dữ liệu báo cáo khi thay đổi Period hoặc StoreId
  useEffect(() => {
    let isCancelled = false
    setIsLoading(true)

    const fetchAllReportData = async () => {
      try {
        const [
          statsRes,
          monthlyStatusRes,
          demographicsRes,
          headcountTrendRes,
          payrollTrendRes,
          payrollFundRes,
          attendanceRes,
          leaveRes,
          salesRes,
          payrollsRes,
        ] = await Promise.allSettled([
          reportApi.getDashboardStats(period, selectedStoreId),
          reportApi.getMonthlyStatus(),
          reportApi.getDemographics(selectedStoreId, false),
          reportApi.getHeadcountTrend(6),
          reportApi.getPayrollTrend(6),
          reportApi.getPayrollFund(period, selectedStoreId),
          reportApi.getAttendanceSummary(period, selectedStoreId),
          reportApi.getLeaveSummary(period, selectedStoreId),
          reportApi.getSalesPerformance({ period, store_id: selectedStoreId }),
          payrollApi.getAll({ period, store_id: selectedStoreId }),
        ])

        if (isCancelled) return

        if (statsRes.status === 'fulfilled') setDashboardStats(statsRes.value)
        if (monthlyStatusRes.status === 'fulfilled') {
          const val = monthlyStatusRes.value
          if (Array.isArray(val)) {
            setMonthlyStatus(val)
          } else if (Array.isArray(val?.by_store)) {
            setMonthlyStatus(val.by_store)
          } else {
            setMonthlyStatus([])
          }
        }
        if (demographicsRes.status === 'fulfilled') {
          const d = demographicsRes.value
          if (d) {
            setDemographics({
              ...d,
              education: d.education || d.education_distribution || [],
              salary_range: d.salary_range || d.salary_distribution || [],
              seniority: d.seniority || d.seniority_distribution || [],
              gender: d.gender || [],
              age_group: d.age_group || []
            })
          }
        }
        if (headcountTrendRes.status === 'fulfilled') {
          const list = headcountTrendRes.value || []
          setHeadcountTrend(list.map((pt: any) => ({
            ...pt,
            month: pt.month || pt.period || '',
            hired: pt.hired ?? pt.new_hires ?? 0,
            resigned: pt.resigned ?? 0,
            active_total: pt.active_total ?? pt.active_count ?? 0
          })))
        }
        if (payrollTrendRes.status === 'fulfilled') {
          const list = payrollTrendRes.value || []
          setPayrollTrend(list.map((pt: any) => ({
            ...pt,
            period: pt.period || pt.salary_period || '',
            employee_count: pt.employee_count ?? 0,
            gross_total: pt.gross_total ?? pt.total_gross ?? 0,
            net_total: pt.net_total ?? pt.total_net ?? 0,
            insurance_total: pt.insurance_total ?? pt.total_insurance ?? 0,
            bonus_total: pt.bonus_total ?? pt.total_bonuses ?? 0
          })))
        }
        if (payrollFundRes.status === 'fulfilled') {
          const pf = payrollFundRes.value
          setPayrollFund(pf ? {
            ...pf,
            total_net_salary: pf.total_net_salary ?? pf.company_totals?.total_net_fund ?? 0,
            total_gross_income: pf.total_gross_income ?? pf.company_totals?.total_gross_fund ?? 0,
            total_insurance_deducted: pf.total_insurance_deducted ?? pf.company_totals?.total_insurance_fund ?? 0
          } : null)
        }
        if (attendanceRes.status === 'fulfilled') {
          const att = attendanceRes.value
          setAttendanceSummary(att ? {
            ...att,
            on_time_rate: att.on_time_rate ?? att.ontime_rate ?? 100,
            total_working_hours: att.total_working_hours ?? 0,
            total_ot_hours: att.total_ot_hours ?? 0,
            by_status: att.by_status || att.status_distribution || []
          } : null)
        }
        if (leaveRes.status === 'fulfilled') {
          const lv = leaveRes.value
          setLeaveSummary(lv ? {
            ...lv,
            by_type: (lv.by_type || []).map((t: any) => ({
              ...t,
              days: t.days ?? t.total_days ?? 0
            })),
            by_status: lv.by_status || []
          } : null)
        }
        if (salesRes.status === 'fulfilled') {
          const sr = salesRes.value
          setSalesReport(sr ? {
            ...sr,
            summary: {
              ...(sr.summary || {}),
              grand_total_revenue: sr.summary?.grand_total_revenue ?? sr.revenue_breakdown?.grand_total_revenue ?? 0,
              avg_kpi_completion_rate: sr.summary?.avg_kpi_completion_rate ?? 0,
              total_sales_employees: sr.summary?.total_sales_employees ?? (sr.sales_staff_details?.length || 0)
            },
            records: sr.records || sr.sales_staff_details || []
          } : null)
        }
        if (payrollsRes.status === 'fulfilled') {
          payrollsCacheRef.current[`${period}_${selectedStoreId || 'all'}`] = payrollsRes.value || []
        }
      } catch (err) {
        console.error('Lỗi khi tải dữ liệu báo cáo:', err)
        toast.error('Có lỗi xảy ra khi cập nhật số liệu báo cáo')
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchAllReportData()

    return () => {
      isCancelled = true
    }
  }, [period, selectedStoreId])

  // Tải dữ liệu Bảng Ma Trận khi chọn Tab Matrix hoặc đổi Năm / Cơ sở
  useEffect(() => {
    if (activeTab === 'matrix') {
      setIsLoadingMatrix(true)
      Promise.allSettled([
        reportApi.getQuarterlyPayrollMatrix(matrixYear, selectedStoreId),
        reportApi.getPayrollMatrixByStore(matrixYear),
        reportApi.getPayrollMatrixByEmployee(matrixYear, selectedStoreId),
      ]).then(([payrollRes, storeRes, empRes]) => {
        if (payrollRes.status === 'fulfilled') setMatrixPayroll(payrollRes.value)
        if (storeRes.status === 'fulfilled') setMatrixByStore(storeRes.value)
        if (empRes.status === 'fulfilled') setMatrixByEmployee(empRes.value)
      }).catch((err) => {
        console.error('Lỗi khi tải bảng ma trận:', err)
        toast.error('Không thể tải dữ liệu bảng ma trận thống kê')
      }).finally(() => {
        setIsLoadingMatrix(false)
      })
    }
  }, [activeTab, matrixYear, selectedStoreId])

  // Xử lý xuất Excel đa sheet
  const handleExportOverviewExcel = async () => {
    try {
      setIsExportingExcel(true)
      toast.info('Đang kết xuất báo cáo Excel đa sheet TechZone...')
      const blob = await reportApi.exportOverviewExcel(period, selectedStoreId)
      const filename = `Bao_cao_tong_hop_TechZone_${period}${selectedStoreId ? `_CN${selectedStoreId}` : ''}.xlsx`
      triggerBlobDownload(blob, filename)
      toast.success('Đã tải xuống file Excel báo cáo tổng hợp!')
    } catch (err: any) {
      console.error('Lỗi xuất Excel:', err)
      toast.error(err.message || 'Không thể xuất file Excel báo cáo')
    } finally {
      setIsExportingExcel(false)
    }
  }

  // Tính toán số lượng an toàn
  const monthlyStatusList = useMemo(() => {
    return Array.isArray(monthlyStatus) ? monthlyStatus : []
  }, [monthlyStatus])

  // Danh sách cơ sở áp dụng: ưu tiên danh mục stores, tự động fallback từ monthlyStatus
  const availableStores = useMemo(() => {
    if (Array.isArray(stores) && stores.length > 0) return stores
    return monthlyStatusList
      .filter((s) => s.store_id)
      .map((s) => ({
        store_id: s.store_id,
        store_name: s.store_name,
        store_code: (s as any).store_code || `TZ-CN${s.store_id}`,
      }))
  }, [stores, monthlyStatusList])

  const totalEmployeesCount = useMemo(() => {
    if (dashboardStats?.total_employees !== undefined) {
      return dashboardStats.total_employees
    }
    if (selectedStoreId) {
      if (demographics?.total_employees !== undefined) return demographics.total_employees
      const matched = monthlyStatusList.find((s) => s.store_id === selectedStoreId)
      if (matched) return matched.total_staff || 0
    }
    return monthlyStatusList.reduce((acc, s) => acc + (s.total_staff || 0), 0)
  }, [dashboardStats, monthlyStatusList, selectedStoreId, demographics])

  const activeEmployeesCount = useMemo(() => {
    if (dashboardStats?.active_employees !== undefined) {
      return dashboardStats.active_employees
    }
    if (selectedStoreId) {
      if (Array.isArray(demographics?.details)) {
        return demographics.details.filter((d: any) => ['ACTIVE', 'PROBATION'].includes(d.employment_status)).length
      }
      const matched = monthlyStatusList.find((s) => s.store_id === selectedStoreId)
      if (matched) return matched.active_staff || 0
    }
    return monthlyStatusList.reduce((acc, s) => acc + (s.active_staff || 0), 0)
  }, [dashboardStats, monthlyStatusList, selectedStoreId, demographics])

  // Dữ liệu cho PieChart cơ cấu quỹ lương
  const payrollBreakdownData = useMemo(() => {
    if (!payrollFund) return []
    return [
      { name: 'Lương cơ bản & ngày công', value: payrollFund.total_gross_income ? Math.max(0, payrollFund.total_gross_income - (payrollFund.total_allowances || 0) - (payrollFund.total_bonuses || 0)) : 0, color: CHART_COLORS.primary },
      { name: 'Tổng phụ cấp', value: payrollFund.total_allowances || 0, color: CHART_COLORS.teal },
      { name: 'Thưởng & hoa hồng', value: payrollFund.total_bonuses || 0, color: CHART_COLORS.warning },
      { name: 'Bảo hiểm trích nộp', value: payrollFund.total_insurance_deducted || 0, color: CHART_COLORS.error },
      { name: 'Thuế TNCN', value: payrollFund.total_tax_deducted || 0, color: CHART_COLORS.purple },
    ].filter((item) => item.value > 0)
  }, [payrollFund])

  // Dữ liệu cho PieChart Chấm công
  const attendancePieData = useMemo(() => {
    if (!attendanceSummary?.by_status) return []
    const colorMap: Record<string, string> = {
      NORMAL: CHART_COLORS.success,
      PRESENT: CHART_COLORS.success,
      LATE: CHART_COLORS.warning,
      EARLY: CHART_COLORS.orange,
      EARLY_LEAVE: CHART_COLORS.orange,
      LATE_AND_EARLY: CHART_COLORS.purple,
      ABSENT: CHART_COLORS.error,
      ON_LEAVE: CHART_COLORS.primary,
      ANNUAL_LEAVE: CHART_COLORS.teal,
      MATERNITY_LEAVE: CHART_COLORS.purple,
      SICK_LEAVE: CHART_COLORS.indigo,
      UNPAID_LEAVE: CHART_COLORS.gray,
    }
    return attendanceSummary.by_status.map((item) => ({
      name: item.label,
      label: item.label,
      value: item.count,
      status: item.status,
      rate: item.rate,
      color: colorMap[item.status] || CHART_COLORS.primary,
    }))
  }, [attendanceSummary])

  // Dữ liệu cho PieChart Nghỉ phép
  const leavePieData = useMemo(() => {
    if (!leaveSummary?.by_type) return []
    return leaveSummary.by_type.map((item, index) => ({
      name: item.type_name,
      type_name: item.type_name,
      value: item.days,
      days: item.days,
      count: item.count || 1,
      color: PALETTE_CATEGORIES[index % PALETTE_CATEGORIES.length],
    }))
  }, [leaveSummary])

  // Dữ liệu Stacked Bar Doanh số
  const salesChartData = useMemo(() => {
    if (!salesReport?.records) return []
    return salesReport.records.map((r) => ({
      name: r.employee_name,
      phone: r.phone_revenue || 0,
      laptop: r.laptop_revenue || 0,
      accessory: r.accessory_revenue || 0,
      total: r.total_revenue || 0,
      kpiRate: r.kpi_completion_rate || 0,
    }))
  }, [salesReport])

  // Xử lý Drilldown khi nhấp vào Biểu đồ Nghỉ phép
  const handleLeavePieClick = (entry: any) => {
    if (!entry) return
    const typeName = entry.name || entry.type_name || entry.payload?.name || entry.payload?.type_name
    const detailsList = Array.isArray(leaveSummary?.details) ? leaveSummary.details : []
    const filtered = detailsList.filter((d: any) => {
      if (!typeName) return false
      return (
        d.type_name === typeName ||
        (d.type_name && typeName && (d.type_name.includes(typeName) || typeName.includes(d.type_name)))
      )
    })
    openSubform({
      title: `Chi tiết đơn nghỉ phép: ${typeName}`,
      subtitle: `Kỳ ${period} - Tổng cộng ${entry.value || entry.days || 0} ngày nghỉ (${filtered.length} đơn)`,
      tag: 'Nghỉ phép',
      filterFields: LEAVE_FILTER_FIELDS,
      columns: [
        {
          key: 'employee_name',
          title: 'Nhân viên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.employee_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code} • {r.store_name}</div>
            </div>
          ),
        },
        {
          key: 'time',
          title: 'Thời gian nghỉ',
          align: 'center',
          render: (r: any) => (
            <div>
              <span style={{ fontWeight: 600 }}>{r.start_date}</span>
              {r.start_date !== r.end_date && <span> → {r.end_date}</span>}
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>({r.total_days} ngày)</div>
            </div>
          ),
        },
        {
          key: 'reason',
          title: 'Lý do xin nghỉ',
          render: (r: any) => <span style={{ color: 'var(--text-secondary)' }}>{r.reason || 'Không ghi lý do'}</span>,
        },
        {
          key: 'status',
          title: 'Trạng thái',
          align: 'center',
          render: (r: any) => (
            <span
              className={`badge ${
                r.status === 'HR_APPROVED'
                  ? 'badge-success'
                  : r.status === 'PENDING' || r.status === 'STORE_APPROVED'
                  ? 'badge-warning'
                  : 'badge-danger'
              }`}
            >
              {r.status_label || r.status}
            </span>
          ),
        },
      ],
      data: filtered,
    })
  }

  // Xử lý Drilldown khi nhấp vào Biểu đồ Chấm công
  const handleAttendancePieClick = (entry: any) => {
    if (!entry) return
    const statusVal = entry.status || entry.payload?.status
    const statusLabel = entry.name || entry.label || entry.payload?.name || entry.payload?.label || ''
    const detailsList = Array.isArray(attendanceSummary?.details) ? attendanceSummary.details : []
    
    const filtered = detailsList.filter((d: any) => {
      // 1. So khớp mã trạng thái chính xác
      if (statusVal && d.status === statusVal) return true
      // 2. So khớp nhãn tiếng Việt
      if (statusLabel && (d.status_label === statusLabel || d.status === statusLabel)) return true
      // 3. Mapping dự phòng hai chiều
      if (statusLabel === 'Đúng giờ' && (d.status === 'NORMAL' || d.status === 'PRESENT')) return true
      if (statusLabel === 'Đi muộn' && (d.status === 'LATE' || d.status === 'LATE_AND_EARLY')) return true
      if (statusLabel === 'Về sớm' && d.status === 'EARLY') return true
      if (statusLabel === 'Vắng mặt' && d.status === 'ABSENT') return true
      if (statusLabel === 'Nghỉ không lương' && d.status === 'UNPAID_LEAVE') return true
      if (statusLabel === 'Nghỉ phép năm' && d.status === 'ANNUAL_LEAVE') return true
      if (statusLabel === 'Nghỉ thai sản' && d.status === 'MATERNITY_LEAVE') return true
      if (statusLabel === 'Nghỉ ốm đau' && d.status === 'SICK_LEAVE') return true
      return false
    })

    openSubform({
      title: `Chi tiết lượt chấm công: ${statusLabel || statusVal}`,
      subtitle: `Kỳ ${period} - Ghi nhận ${filtered.length} lượt công`,
      tag: 'Chấm công',
      filterFields: ATTENDANCE_FILTER_FIELDS,
      columns: [
        {
          key: 'employee_name',
          title: 'Nhân viên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.employee_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code} • {r.store_name}</div>
            </div>
          ),
        },
        { key: 'work_date', title: 'Ngày làm việc', align: 'center' },
        {
          key: 'shift_time',
          title: 'Check-in / Out',
          align: 'center',
          render: (r: any) => (
            <span style={{ fontFamily: 'monospace' }}>
              {r.check_in_time || '—'} - {r.check_out_time || '—'}
            </span>
          ),
        },
        {
          key: 'hours',
          title: 'Giờ làm & OT',
          align: 'center',
          render: (r: any) => (
            <span>
              {r.actual_work_hours}h {Number(r.overtime_hours) > 0 && <span style={{ color: CHART_COLORS.warning }}>(OT: {r.overtime_hours}h)</span>}
            </span>
          ),
        },
        {
          key: 'late',
          title: 'Đi muộn',
          align: 'center',
          render: (r: any) => (
            <span>
              {Number(r.late_minutes) > 0 ? (
                <span style={{ color: CHART_COLORS.error, fontWeight: 600 }}>{r.late_minutes} phút</span>
              ) : (
                <span style={{ color: 'var(--text-tertiary)' }}>0p</span>
              )}
            </span>
          ),
        },
        {
          key: 'status',
          title: 'Trạng thái',
          align: 'center',
          render: (r: any) => (
            <span
              className={`badge ${
                r.status === 'NORMAL' || r.status === 'PRESENT'
                  ? 'badge-success'
                  : r.status === 'LATE' || r.status === 'EARLY' || r.status === 'LATE_AND_EARLY'
                  ? 'badge-warning'
                  : 'badge-danger'
              }`}
            >
              {r.status_label || r.status}
            </span>
          ),
        },
      ],
      data: filtered,
    })
  }

  // Xử lý Drilldown khi nhấp vào Biểu đồ Xu hướng quân số hệ thống
  const handleHeadcountTrendClick = (chartEvent: any) => {
    const clickedMonth = chartEvent?.activePayload?.[0]?.payload?.month || chartEvent?.month
    if (!clickedMonth) return
    const detailsList = Array.isArray(demographics?.details) ? demographics.details : []
    openSubform({
      title: `Danh sách quân số: Tháng ${clickedMonth}`,
      subtitle: `Ghi nhận ${detailsList.length} nhân sự đang hoạt động trong toàn hệ thống`,
      tag: 'Quân số hệ thống',
      filterFields: EMPLOYEE_FILTER_FIELDS,
      columns: [
        {
          key: 'full_name',
          title: 'Họ và Tên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.full_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code}</div>
            </div>
          ),
        },
        { key: 'position_name', title: 'Chức vụ' },
        { key: 'store_name', title: 'Cơ sở / Chi nhánh' },
        {
          key: 'seniority_years',
          title: 'Thâm niên',
          align: 'center',
          render: (r: any) => <span>{r.seniority_years ? `${r.seniority_years} năm` : '—'}</span>,
        },
        {
          key: 'basic_salary',
          title: 'Lương HĐ',
          align: 'right',
          render: (r: any) => (
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: CHART_COLORS.primary }}>
              {formatFullCurrency(r.basic_salary || 0)}
            </span>
          ),
        },
      ],
      data: detailsList,
    })
  }

  // Xử lý Drilldown khi nhấp vào Biểu đồ Học vấn
  const handleEducationBarClick = (entry: any) => {
    if (!entry) return
    const levelName = entry.level_name || entry.education_level || entry.name
    const detailsList = Array.isArray(demographics?.details) ? demographics.details : []
    const filtered = detailsList.filter((d: any) => d.education_level === levelName)
    openSubform({
      title: `Danh sách nhân sự: Trình độ ${levelName}`,
      subtitle: `Tổng cộng ${filtered.length} nhân sự có trình độ này`,
      tag: 'Trình độ học vấn',
      filterFields: EDUCATION_FILTER_FIELDS,
      columns: [
        {
          key: 'full_name',
          title: 'Họ và Tên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.full_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code}</div>
            </div>
          ),
        },
        { key: 'education_level', title: 'Trình độ' },
        { key: 'position_name', title: 'Chức vụ' },
        { key: 'store_name', title: 'Cơ sở / Chi nhánh' },
        {
          key: 'seniority_years',
          title: 'Thâm niên',
          align: 'center',
          render: (r: any) => <span>{r.seniority_years ? `${r.seniority_years} năm` : '—'}</span>,
        },
        {
          key: 'basic_salary',
          title: 'Lương HĐ',
          align: 'right',
          render: (r: any) => (
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: CHART_COLORS.primary }}>
              {formatFullCurrency(r.basic_salary || 0)}
            </span>
          ),
        },
      ],
      data: filtered,
    })
  }

  // Xử lý Drilldown khi nhấp vào Biểu đồ Thâm niên
  const handleSeniorityPieClick = (entry: any) => {
    if (!entry) return
    const groupName = entry.seniority_group || entry.name
    const detailsList = Array.isArray(demographics?.details) ? demographics.details : []
    const filtered = detailsList.filter((d: any) => d.seniority_group === groupName)
    openSubform({
      title: `Danh sách nhân sự: Thâm niên ${groupName}`,
      subtitle: `Tổng cộng ${filtered.length} nhân sự thuộc nhóm thâm niên này`,
      tag: 'Thâm niên công tác',
      filterFields: SENIORITY_FILTER_FIELDS,
      columns: [
        {
          key: 'full_name',
          title: 'Họ và Tên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.full_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code}</div>
            </div>
          ),
        },
        { key: 'position_name', title: 'Chức vụ' },
        { key: 'store_name', title: 'Cơ sở / Chi nhánh' },
        {
          key: 'seniority_years',
          title: 'Số năm công tác',
          align: 'center',
          render: (r: any) => <span style={{ fontWeight: 600 }}>{r.seniority_years} năm</span>,
        },
        {
          key: 'join_date',
          title: 'Ngày vào làm',
          align: 'center',
          render: (r: any) => <span>{r.join_date || '—'}</span>,
        },
        {
          key: 'basic_salary',
          title: 'Lương HĐ',
          align: 'right',
          render: (r: any) => (
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: CHART_COLORS.primary }}>
              {formatFullCurrency(r.basic_salary || 0)}
            </span>
          ),
        },
      ],
      data: filtered,
    })
  }

  // Xử lý Drilldown khi nhấp vào Biểu đồ Bậc lương HĐ
  const handleSalaryBarClick = (entry: any) => {
    if (!entry) return
    const bracketName = entry.salary_bracket || entry.name
    const detailsList = Array.isArray(demographics?.details) ? demographics.details : []
    const filtered = detailsList.filter((d: any) => d.salary_bracket === bracketName)
    openSubform({
      title: `Danh sách nhân sự: Mức lương ${bracketName}`,
      subtitle: `Tổng cộng ${filtered.length} nhân sự thuộc phân khúc lương này`,
      tag: 'Khung lương hợp đồng',
      filterFields: SALARY_BRACKET_FILTER_FIELDS,
      columns: [
        {
          key: 'full_name',
          title: 'Họ và Tên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.full_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code}</div>
            </div>
          ),
        },
        { key: 'position_name', title: 'Chức vụ' },
        { key: 'store_name', title: 'Cơ sở / Chi nhánh' },
        {
          key: 'basic_salary',
          title: 'Lương thỏa thuận HĐ',
          align: 'right',
          render: (r: any) => (
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: CHART_COLORS.primary }}>
              {formatFullCurrency(r.basic_salary || 0)}
            </span>
          ),
        },
        {
          key: 'seniority_years',
          title: 'Thâm niên',
          align: 'center',
          render: (r: any) => <span>{r.seniority_years ? `${r.seniority_years} năm` : '—'}</span>,
        },
      ],
      data: filtered,
    })
  }

  // Xử lý Drilldown khi nhấp vào hàng Cơ sở ở Tab 1
  const handleStoreRowClick = (store: any) => {
    if (!store) return
    const detailsList = Array.isArray(demographics?.details) ? demographics.details : []
    const filtered = detailsList.filter((d: any) => d.store_id === store.store_id || d.store_name === store.store_name)
    openSubform({
      title: `Nhân sự cơ sở: ${store.store_name}`,
      subtitle: `Ghi nhận ${filtered.length} nhân sự | Quỹ lương cơ bản: ${formatFullCurrency(store.total_contract_salary || 0)}`,
      tag: 'Chi nhánh',
      filterFields: EMPLOYEE_FILTER_FIELDS,
      columns: [
        {
          key: 'full_name',
          title: 'Họ và Tên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.full_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code}</div>
            </div>
          ),
        },
        { key: 'position_name', title: 'Chức vụ' },
        {
          key: 'seniority_years',
          title: 'Thâm niên',
          align: 'center',
          render: (r: any) => <span>{r.seniority_years ? `${r.seniority_years} năm` : '—'}</span>,
        },
        {
          key: 'basic_salary',
          title: 'Lương HĐ',
          align: 'right',
          render: (r: any) => (
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: CHART_COLORS.primary }}>
              {formatFullCurrency(r.basic_salary || 0)}
            </span>
          ),
        },
        {
          key: 'education_level',
          title: 'Học vấn',
          align: 'center',
          render: (r: any) => <span>{r.education_level || '—'}</span>,
        },
      ],
      data: filtered,
    })
  }

  // Xử lý Drilldown khi nhấp vào hàng Cơ sở ở Tab 3 (Chấm công)
  const handleStoreAttendanceRowClick = (store: any) => {
    if (!store) return
    const detailsList = Array.isArray(attendanceSummary?.details) ? attendanceSummary.details : []
    const filtered = detailsList.filter((d: any) => d.store_id === store.store_id || d.store_name === store.store_name)
    openSubform({
      title: `Chấm công cơ sở: ${store.store_name}`,
      subtitle: `Kỳ ${period} - Ghi nhận ${filtered.length} lượt chấm công`,
      tag: 'Chấm công',
      filterFields: ATTENDANCE_FILTER_FIELDS,
      columns: [
        {
          key: 'employee_name',
          title: 'Nhân viên',
          render: (r: any) => (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.employee_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.employee_code}</div>
            </div>
          ),
        },
        { key: 'work_date', title: 'Ngày làm việc', align: 'center' },
        {
          key: 'shift_time',
          title: 'Check-in / Out',
          align: 'center',
          render: (r: any) => (
            <span style={{ fontFamily: 'monospace' }}>
              {r.check_in_time || '—'} - {r.check_out_time || '—'}
            </span>
          ),
        },
        {
          key: 'hours',
          title: 'Giờ làm & OT',
          align: 'center',
          render: (r: any) => (
            <span>
              {r.actual_work_hours}h {Number(r.overtime_hours) > 0 && <span style={{ color: CHART_COLORS.warning }}>(OT: {r.overtime_hours}h)</span>}
            </span>
          ),
        },
        {
          key: 'late',
          title: 'Đi muộn',
          align: 'center',
          render: (r: any) => (
            <span>
              {Number(r.late_minutes) > 0 ? (
                <span style={{ color: CHART_COLORS.error, fontWeight: 600 }}>{r.late_minutes} phút</span>
              ) : (
                <span style={{ color: 'var(--text-tertiary)' }}>0p</span>
              )}
            </span>
          ),
        },
        {
          key: 'status',
          title: 'Trạng thái',
          align: 'center',
          render: (r: any) => (
            <span
              className={`badge ${
                r.status === 'NORMAL' || r.status === 'PRESENT'
                  ? 'badge-success'
                  : r.status === 'LATE' || r.status === 'EARLY' || r.status === 'LATE_AND_EARLY'
                  ? 'badge-warning'
                  : 'badge-danger'
              }`}
            >
              {r.status_label || r.status}
            </span>
          ),
        },
      ],
      data: filtered,
    })
  }

  return (
    <div className="page-container reports-page-wrapper">
      {/* Header trang */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title">Trung tâm Báo cáo & Thống kê</h1>
          <p className="page-subtitle" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Hệ thống phân tích nguồn nhân lực, chi phí quỹ lương và hiệu suất chuỗi cửa hàng TechZone
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setIsPrintModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Bản in / Xuất PDF (A4)
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={isExportingExcel}
            onClick={handleExportOverviewExcel}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {isExportingExcel ? 'Đang xuất...' : 'Xuất Excel'}
          </button>
        </div>
      </div>

      {/* Thanh điều khiển bộ lọc Tháng & Chi nhánh */}
      <div className="reports-filter-bar">
        <div className="reports-filter-left">
          <MonthPicker
            value={period}
            onChange={setPeriod}
            label="Kỳ thống kê"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Cơ sở áp dụng:
            </span>
            <select
              className="form-control"
              style={{ fontSize: '13px', padding: '6px 12px', minWidth: '240px' }}
              value={selectedStoreId || ''}
              onChange={(e) => {
                const val = e.target.value
                setSelectedStoreId(val ? Number(val) : undefined)
              }}
            >
              <option value="">Toàn bộ hệ thống (Tất cả cửa hàng)</option>
              {availableStores.map((s) => (
                <option key={s.store_id} value={s.store_id}>
                  {s.store_name} {s.store_code ? `(${s.store_code})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="reports-filter-right">
          <span style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}>
            Dữ liệu tự động cập nhật từ CSDL Supabase
          </span>
        </div>
      </div>

      {/* 3 Thẻ StatCard cốt lõi Quản trị Nhân sự HRM */}
      <div className="stat-grid-3 kpi-hover-grid">
        <StatCard
          label={selectedStoreId ? "Nhân sự cơ sở đã chọn" : `Tổng quân số kỳ (${period})`}
          value={totalEmployeesCount}
          iconColor="blue"
          footerNote={
            dashboardStats?.resigned_employees
              ? `Đang làm việc: ${activeEmployeesCount} (Thôi việc kỳ này: ${dashboardStats.resigned_employees})`
              : dashboardStats?.new_hires
              ? `Đang làm việc: ${activeEmployeesCount} (Tuyển mới kỳ này: ${dashboardStats.new_hires})`
              : `Đang làm việc: ${activeEmployeesCount} nhân sự`
          }
        />
        <StatCard
          label={`Quỹ thực chi Net (${period})`}
          value={formatFullCurrency(payrollFund?.total_net_salary || 0)}
          iconColor="green"
          footerNote={`Trước thuế: ${formatFullCurrency(payrollFund?.total_gross_income || 0)}`}
        />
        <StatCard
          label="Tỷ lệ chuyên cần đúng giờ"
          value={typeof attendanceSummary?.on_time_rate === 'number' ? `${attendanceSummary.on_time_rate.toFixed(1)}%` : '100%'}
          iconColor="amber"
          footerNote={`Tổng giờ làm: ${attendanceSummary?.total_working_hours || 0}h (OT: ${attendanceSummary?.total_ot_hours || 0}h)`}
        />
        {/* Ghi chú: Chỉ số Doanh số tạm ẩn theo yêu cầu phạm vi dự án HRM
        <StatCard
          label={`Doanh số ghi nhận (${period})`}
          value={formatFullCurrency(salesReport?.summary?.grand_total_revenue || 0)}
          iconColor="red"
          footerNote={`KPI đạt: ${salesReport?.summary?.avg_kpi_completion_rate ? `${salesReport.summary.avg_kpi_completion_rate.toFixed(1)}%` : '0%'}`}
        />
        */}
      </div>

      {/* BỐ CỤC MAIN - SUBFORM (MASTER - DETAIL CHIA 2 CỘT TƯƠNG TÁC) */}
      <div className={`mypayslip-layout ${isSubformOpen ? 'has-subform' : 'is-full-width'}`}>
        {/* CỘT TRÁI (MAIN PANE): DASHBOARD TABS, BIỂU ĐỒ RECHARTS & BẢNG MA TRẬN */}
        <div className="mypayslip-main-pane">
          {/* Tabs chuyển đổi các mảng phân tích nhân sự */}
          <div className="reports-tab-nav">
            <button
              className={`reports-tab-btn ${activeTab === 'demographics' ? 'active' : ''}`}
              onClick={() => setActiveTab('demographics')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              1. Cơ cấu & Biến động nhân sự
            </button>

            <button
              className={`reports-tab-btn ${activeTab === 'payroll' ? 'active' : ''}`}
              onClick={() => setActiveTab('payroll')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              2. Chi phí & Quỹ lương
            </button>

            <button
              className={`reports-tab-btn ${activeTab === 'attendance' ? 'active' : ''}`}
              onClick={() => setActiveTab('attendance')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              3. Chấm công & Nghỉ phép
            </button>

            {/* TAB 4: BẢNG MA TRẬN ĐA CHIỀU (CROSS-TAB MATRIX) */}
            <button
              className={`reports-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
              style={{ fontWeight: activeTab === 'matrix' ? 700 : 500 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M3 15h18" />
                <path d="M9 3v18" />
                <path d="M15 3v18" />
              </svg>
              4. Thống kê Ma trận (Matrix Pivot)
            </button>
          </div>

      {/* Nội dung từng Tab */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <div className="spinner" style={{ margin: '0 auto 16px auto' }} />
          <span>Đang tổng hợp dữ liệu biểu đồ và thống kê...</span>
        </div>
      ) : (
        <>
          {/* ========================================================================= */}
          {/* TAB 1: NHÂN SỰ & HỌC VẤN */}
          {/* ========================================================================= */}
          {activeTab === 'demographics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="charts-grid-2">
                {/* Biểu đồ 1: AreaChart Biến động quân số */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Xu hướng biến động quân số hệ thống</h3>
                      <p className="chart-card-desc">Lịch sử tiếp nhận tuyển mới và số lượng nhân sự qua các tháng (Bấm vào để xem chi tiết)</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {headcountTrend.length === 0 ? (
                      <div className="chart-empty-state">Chưa có dữ liệu lịch sử quân số</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={headcountTrend}
                          margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                          onClick={handleHeadcountTrendClick}
                          style={{ cursor: 'pointer' }}
                        >
                          <defs>
                            <linearGradient id="colorHired" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.4} />
                              <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={CHART_COLORS.success} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={CHART_COLORS.success} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f1f5f9)" />
                          <XAxis dataKey="month" stroke="var(--text-tertiary)" fontSize={11} />
                          <YAxis stroke="var(--text-tertiary)" fontSize={11} allowDecimals={false} />
                          <Tooltip content={<CustomChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                          <Area
                            type="monotone"
                            dataKey="active_total"
                            name="Quân số tích luỹ"
                            stroke={CHART_COLORS.success}
                            fillOpacity={1}
                            fill="url(#colorActive)"
                            isAnimationActive={isChartAnimated}
                          />
                          <Area
                            type="monotone"
                            dataKey="hired"
                            name="Tuyển mới"
                            stroke={CHART_COLORS.primary}
                            fillOpacity={1}
                            fill="url(#colorHired)"
                            isAnimationActive={isChartAnimated}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Biểu đồ 2: BarChart Học vấn */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Cơ cấu trình độ học vấn</h3>
                      <p className="chart-card-desc">Tỷ lệ bằng cấp của đội ngũ nhân viên đang công tác</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {!demographics?.education || demographics.education.length === 0 ? (
                      <div className="chart-empty-state">Chưa ghi nhận dữ liệu học vấn</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={demographics.education}
                          margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f1f5f9)" />
                          <XAxis dataKey="education_level" stroke="var(--text-tertiary)" fontSize={11} />
                          <YAxis stroke="var(--text-tertiary)" fontSize={11} allowDecimals={false} />
                          <Tooltip content={<CustomChartTooltip />} />
                          <Bar
                            dataKey="total"
                            name="Số nhân sự"
                            radius={[4, 4, 0, 0]}
                            onClick={(entry) => handleEducationBarClick(entry)}
                            style={{ cursor: 'pointer' }}
                            isAnimationActive={isChartAnimated}
                          >
                            {demographics.education.map((_, index) => (
                              <Cell key={`edu-cell-${index}`} fill={PALETTE_CATEGORIES[index % PALETTE_CATEGORIES.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Biểu đồ 3: BarChart Ngang Mức lương hợp đồng */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Phân khúc mức lương thỏa thuận theo HĐ</h3>
                      <p className="chart-card-desc">Thống kê mức lương cơ bản ghi nhận trên hợp đồng lao động</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {!demographics?.salary_range || demographics.salary_range.length === 0 ? (
                      <div className="chart-empty-state">Chưa có thông tin hợp đồng</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={demographics.salary_range}
                          margin={{ top: 10, right: 30, left: 30, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f1f5f9)" />
                          <XAxis type="number" stroke="var(--text-tertiary)" fontSize={11} allowDecimals={false} />
                          <YAxis dataKey="salary_range" type="category" stroke="var(--text-tertiary)" fontSize={11} />
                          <Tooltip content={<CustomChartTooltip />} />
                          <Bar
                            dataKey="total"
                            name="Số lượng"
                            fill={CHART_COLORS.indigo}
                            radius={[0, 4, 4, 0]}
                            onClick={(entry) => handleSalaryBarClick(entry)}
                            style={{ cursor: 'pointer' }}
                            isAnimationActive={isChartAnimated}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Biểu đồ 4: PieChart Thâm niên công tác */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Thâm niên gắn bó với TechZone</h3>
                      <p className="chart-card-desc">Phân bố nhân sự theo khoảng thời gian làm việc thực tế</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {!demographics?.seniority || demographics.seniority.length === 0 ? (
                      <div className="chart-empty-state">Chưa có dữ liệu thâm niên</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={demographics.seniority}
                            dataKey="total"
                            nameKey="seniority_group"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={4}
                            label={({ name, percent }: any) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                            labelLine={false}
                            onClick={(entry) => handleSeniorityPieClick(entry)}
                            style={{ cursor: 'pointer' }}
                            isAnimationActive={isChartAnimated}
                          >
                            {demographics.seniority.map((_, index) => (
                              <Cell key={`sen-cell-${index}`} fill={PALETTE_CATEGORIES[index % PALETTE_CATEGORIES.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>

              {/* Bảng phân bổ cơ sở */}
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="card-title">Chi tiết phân bổ nhân lực & quỹ lương theo Chi nhánh / Phòng ban</h3>
                  <span className="badge badge-info" style={{ fontSize: '12px' }}>
                    {monthlyStatusList.length} Cơ sở hoạt động
                  </span>
                </div>
                <div className="table-responsive">
                  <table className="table data-table">
                    <thead>
                      <tr>
                        <th>Cơ sở / Đơn vị</th>
                        <th style={{ textAlign: 'center' }}>Tổng nhân sự</th>
                        <th style={{ textAlign: 'center' }}>Chính thức</th>
                        <th style={{ textAlign: 'center' }}>Thử việc</th>
                        <th style={{ textAlign: 'center' }}>Thôi việc</th>
                        <th style={{ textAlign: 'right' }}>Quỹ lương cơ bản HĐ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyStatusList.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)' }}>
                            Chưa có dữ liệu cơ sở
                          </td>
                        </tr>
                      ) : (
                        monthlyStatusList.map((s) => (
                          <tr
                            key={s.store_id}
                            onClick={() => handleStoreRowClick(s)}
                            style={{ cursor: 'pointer' }}
                            title="Bấm vào để xem danh sách nhân sự cơ sở này"
                          >
                            <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{s.store_name}</span>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>{s.total_staff}</td>
                            <td style={{ textAlign: 'center', color: 'var(--status-success)' }}>{s.active_staff}</td>
                            <td style={{ textAlign: 'center', color: 'var(--status-warning)' }}>{s.probation_staff}</td>
                            <td style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>{s.resigned_staff}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                              {formatFullCurrency(s.total_contract_salary || 0)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: CHI PHÍ & QUỸ LƯƠNG */}
          {/* ========================================================================= */}
          {activeTab === 'payroll' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="charts-grid-2">
                {/* Biểu đồ 1: ComposedChart Xu hướng quỹ lương */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Biến động quỹ chi trả tiền lương qua các kỳ</h3>
                      <p className="chart-card-desc">So sánh tổng thu nhập Gross, thực nhận Net và chi phí bảo hiểm (Bấm vào cột tháng để xem bảng lương)</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {payrollTrend.length === 0 ? (
                      <div className="chart-empty-state">Chưa có lịch sử bảng lương</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={payrollTrend}
                          margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
                          onClick={handlePayrollTrendClick}
                          style={{ cursor: 'pointer' }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f1f5f9)" />
                          <XAxis dataKey="period" stroke="var(--text-tertiary)" fontSize={11} />
                          <YAxis
                            stroke="var(--text-tertiary)"
                            fontSize={11}
                            tickFormatter={(v) => formatChartCurrency(v)}
                          />
                          <Tooltip
                            content={
                              <CustomChartTooltip
                                formatter={(val) => (typeof val === 'number' ? formatFullCurrency(val) : val)}
                              />
                            }
                          />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                          <Bar
                            dataKey="gross_total"
                            name="Tổng Gross"
                            fill={CHART_COLORS.primaryLight}
                            radius={[4, 4, 0, 0]}
                            isAnimationActive={isChartAnimated}
                            onClick={(entry) => handlePayrollTrendClick(entry)}
                            style={{ cursor: 'pointer' }}
                          />
                          <Bar
                            dataKey="net_total"
                            name="Thực chi Net"
                            fill={CHART_COLORS.navy}
                            radius={[4, 4, 0, 0]}
                            isAnimationActive={isChartAnimated}
                            onClick={(entry) => handlePayrollTrendClick(entry)}
                            style={{ cursor: 'pointer' }}
                          />
                          <Line
                            type="monotone"
                            dataKey="insurance_total"
                            name="Trích nộp BHXH"
                            stroke={CHART_COLORS.error}
                            strokeWidth={2}
                            isAnimationActive={isChartAnimated}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Biểu đồ 2: PieChart Cơ cấu quỹ lương kỳ hiện tại */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Cơ cấu quỹ lương tháng {period}</h3>
                      <p className="chart-card-desc">Tỷ trọng các cấu phần thu nhập, phụ cấp, thưởng và trích nộp (Bấm vào để xem chi tiết)</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {payrollBreakdownData.length === 0 ? (
                      <div className="chart-empty-state">Kỳ lương này chưa phát sinh dữ liệu chi trả</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={payrollBreakdownData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={3}
                            label={({ name, percent }: any) => `${name}: ${((percent || 0) * 100).toFixed(1)}%`}
                            labelLine={false}
                            isAnimationActive={isChartAnimated}
                            onClick={(entry) => handlePayrollBreakdownClick(entry)}
                            style={{ cursor: 'pointer' }}
                          >
                            {payrollBreakdownData.map((entry, index) => (
                              <Cell key={`pay-breakdown-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={
                              <CustomChartTooltip
                                formatter={(val) => (typeof val === 'number' ? formatFullCurrency(val) : val)}
                              />
                            }
                          />
                          <Legend wrapperStyle={{ fontSize: '11.5px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>

              {/* Bảng phân tích chi phí lương */}
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="card-title">Bảng tổng hợp thanh toán & đối soát lương tháng {period}</h3>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      try {
                        toast.info('Đang tải file Excel quỹ lương...')
                        const blob = await reportApi.exportPayrollSummaryExcel(period)
                        triggerBlobDownload(blob, `Quy_luong_TechZone_${period}.xlsx`)
                        toast.success('Đã tải file Excel quỹ lương!')
                      } catch (err: any) {
                        toast.error(err.message || 'Lỗi tải file')
                      }
                    }}
                  >
                    Tải bảng lương Excel
                  </button>
                </div>
                <div className="card-body">
                  <div className="stat-grid-4">
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Tổng thu nhập Gross</span>
                      <div className="stat-card-value" style={{ fontSize: '18px', color: CHART_COLORS.primary }}>
                        {formatFullCurrency(payrollFund?.total_gross_income || 0)}
                      </div>
                    </div>
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Tổng trích nộp BHXH</span>
                      <div className="stat-card-value" style={{ fontSize: '18px', color: CHART_COLORS.error }}>
                        {formatFullCurrency(payrollFund?.total_insurance_deducted || 0)}
                      </div>
                    </div>
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Thuế TNCN khấu trừ</span>
                      <div className="stat-card-value" style={{ fontSize: '18px', color: CHART_COLORS.purple }}>
                        {formatFullCurrency(payrollFund?.total_tax_deducted || 0)}
                      </div>
                    </div>
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Thực trả nhân viên (Net)</span>
                      <div className="stat-card-value" style={{ fontSize: '18px', color: CHART_COLORS.success }}>
                        {formatFullCurrency(payrollFund?.total_net_salary || 0)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: CHẤM CÔNG & NGHỈ PHÉP */}
          {/* ========================================================================= */}
          {activeTab === 'attendance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="charts-grid-2">
                {/* Biểu đồ 1: Pie Tỷ lệ chuyên cần */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Tỷ lệ trạng thái chấm công tháng {period}</h3>
                      <p className="chart-card-desc">Cơ cấu chuyên cần: Đúng giờ, Đi muộn, Về sớm, Nghỉ phép</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {attendancePieData.length === 0 ? (
                      <div className="chart-empty-state">Chưa có dữ liệu chấm công kỳ này</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={attendancePieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={85}
                            paddingAngle={3}
                            label={({ name, percent }: any) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                            labelLine={false}
                            isAnimationActive={isChartAnimated}
                            onClick={(entry) => handleAttendancePieClick(entry)}
                            style={{ cursor: 'pointer' }}
                          >
                            {attendancePieData.map((entry, index) => (
                              <Cell key={`att-cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={
                              <CustomChartTooltip
                                formatter={(val: any) => `${val} lượt chấm công`}
                              />
                            }
                          />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Biểu đồ 2: Cơ cấu loại đơn nghỉ phép */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <div>
                      <h3 className="chart-card-title">Cơ cấu loại nghỉ phép (Số ngày nghỉ)</h3>
                      <p className="chart-card-desc">Phân loại ngày nghỉ: Phép năm, Nghỉ ốm, Thai sản, Việc riêng (Bấm vào để xem chi tiết)</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {leavePieData.length === 0 ? (
                      <div className="chart-empty-state">Không có đơn xin nghỉ phép trong kỳ</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={leavePieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={85}
                            paddingAngle={3}
                            label={({ name, value }: any) => `${name}: ${value} ngày`}
                            labelLine={false}
                            isAnimationActive={isChartAnimated}
                            onClick={(entry) => handleLeavePieClick(entry)}
                            style={{ cursor: 'pointer' }}
                          >
                            {leavePieData.map((entry, index) => (
                              <Cell key={`leave-cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={
                              <CustomChartTooltip
                                formatter={(val: any, _name?: string, item?: any) => `${val} ngày nghỉ (${item?.payload?.count || 1} đơn)`}
                              />
                            }
                          />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>

              {/* Thẻ tóm tắt chỉ số Chuyên cần & Nghỉ phép */}
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 className="card-title">Chỉ số vận hành chuyên cần & Kỷ luật lao động tháng {period}</h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Tổng hợp giờ công, làm thêm OT và tình hình giải quyết chế độ nghỉ phép toàn chuỗi cửa hàng
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleExportOverviewExcel}
                    disabled={isExportingExcel}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {isExportingExcel ? 'Đang xuất...' : 'Xuất Excel Chấm công & Phép'}
                  </button>
                </div>
                <div className="card-body">
                  <div className="stat-grid-4">
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Tổng lượt chấm công</span>
                      <div className="stat-card-value" style={{ fontSize: '18px' }}>
                        {attendanceSummary?.total_records || 0} lượt
                      </div>
                    </div>
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Tỷ lệ đúng giờ tiêu chuẩn</span>
                      <div className="stat-card-value" style={{ fontSize: '18px', color: CHART_COLORS.success }}>
                        {attendanceSummary?.on_time_rate ? `${attendanceSummary.on_time_rate.toFixed(1)}%` : '0%'}
                      </div>
                    </div>
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Tổng giờ làm việc & OT</span>
                      <div className="stat-card-value" style={{ fontSize: '18px', color: CHART_COLORS.primary }}>
                        {attendanceSummary?.total_working_hours || 0}h <span style={{ fontSize: '12px', color: CHART_COLORS.warning }}>(OT: {attendanceSummary?.total_ot_hours || 0}h)</span>
                      </div>
                    </div>
                    <div className="stat-card" style={{ padding: '12px' }}>
                      <span className="stat-card-label">Tổng số đơn nghỉ phép</span>
                      <div className="stat-card-value" style={{ fontSize: '18px', color: CHART_COLORS.indigo }}>
                        {leaveSummary?.total_requests || 0} đơn
                      </div>
                    </div>
                  </div>

                  {/* Bảng chi tiết chuyên cần theo điểm bán */}
                  <div style={{ marginTop: '20px', overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%', fontSize: '13px' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '50px', textAlign: 'center' }}>STT</th>
                          <th>Điểm bán / Cơ sở</th>
                          <th style={{ textAlign: 'center' }}>Quân số</th>
                          <th style={{ textAlign: 'center' }}>Đúng giờ</th>
                          <th style={{ textAlign: 'right' }}>Giờ làm thực tế</th>
                          <th style={{ textAlign: 'right' }}>Giờ tăng ca (OT)</th>
                          <th style={{ textAlign: 'center' }}>Đơn nghỉ phép</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyStatusList.map((store, idx) => (
                          <tr
                            key={store.store_id || idx}
                            onClick={() => handleStoreAttendanceRowClick(store)}
                            style={{ cursor: 'pointer' }}
                            title="Bấm vào để xem danh sách chấm công của cơ sở này"
                          >
                            <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                            <td style={{ fontWeight: 600 }}>
                              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{store.store_name}</span>
                            </td>
                            <td style={{ textAlign: 'center' }}>{store.active_staff || 0} NS</td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="badge badge-success" style={{ fontSize: '11px' }}>
                                {attendanceSummary?.on_time_rate ? `${attendanceSummary.on_time_rate.toFixed(0)}%` : '96%'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                              {attendanceSummary?.total_working_hours ? Math.round(attendanceSummary.total_working_hours / Math.max(monthlyStatusList.length, 1)) : 0}h
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', color: CHART_COLORS.warning, fontWeight: 600 }}>
                              {attendanceSummary?.total_ot_hours ? Math.round(attendanceSummary.total_ot_hours / Math.max(monthlyStatusList.length, 1)) : 0}h
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="badge badge-info" style={{ fontSize: '11px' }}>
                                {leaveSummary?.total_requests || 0} đơn
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: THỐNG KÊ MA TRẬN ĐA CHIỀU THEO THỜI GIAN & ĐỐI TƯỢNG (MATRIX)     */}
          {/* ========================================================================= */}
          {activeTab === 'matrix' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="matrix-report-card">
                {/* Toolbar điều khiển ma trận */}
                <div className="matrix-toolbar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Năm thống kê:</span>
                      <select
                        className="form-control"
                        style={{ fontSize: '13px', padding: '6px 12px', width: 'auto', fontWeight: 600 }}
                        value={matrixYear}
                        onChange={(e) => setMatrixYear(Number(e.target.value))}
                      >
                        <option value={2026}>Năm 2026</option>
                        <option value={2025}>Năm 2025</option>
                        <option value={2024}>Năm 2024</option>
                      </select>
                    </div>

                    <div className="matrix-view-toggle">
                      <button
                        type="button"
                        className={`matrix-view-btn ${matrixViewMode === 'payroll' ? 'active' : ''}`}
                        onClick={() => setMatrixViewMode('payroll')}
                      >
                        <DollarSign size={14} />
                        Bảng 1: Quỹ lương theo Quý
                      </button>
                      <button
                        type="button"
                        className={`matrix-view-btn ${matrixViewMode === 'store' ? 'active' : ''}`}
                        onClick={() => setMatrixViewMode('store')}
                      >
                        <Building2 size={14} />
                        Bảng 2: Theo Chi nhánh
                      </button>
                      <button
                        type="button"
                        className={`matrix-view-btn ${matrixViewMode === 'employee' ? 'active' : ''}`}
                        onClick={() => setMatrixViewMode('employee')}
                      >
                        <UserIcon size={14} />
                        Bảng 3: Theo Nhân viên
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>💡 Nhấp vào ô hoặc nút</span>
                    <span className="btn btn-icon btn-sm btn-secondary" style={{ width: '22px', height: '22px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Eye size={12} />
                    </span>
                    <span>để xem chi tiết 1-N ở Subform bên cạnh</span>
                  </div>
                </div>

                {/* Nội dung bảng ma trận */}
                <div className="matrix-table-container">
                  {isLoadingMatrix ? (
                    <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
                      <div className="spinner" style={{ margin: '0 auto 12px auto' }} />
                      <span>Đang tính toán số liệu ma trận 4 Quý năm {matrixYear}...</span>
                    </div>
                  ) : matrixViewMode === 'payroll' ? (
                    /* ------------------------------------------------------------- */
                    /* BẢNG 1: MA TRẬN QUỸ LƯƠNG & CHI PHÍ THEO QUÝ VÀ NĂM          */
                    /* ------------------------------------------------------------- */
                    <table className="matrix-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', minWidth: '260px' }}>Chỉ số chi phí lương (Năm {matrixYear})</th>
                          <th style={{ textAlign: 'right', minWidth: '130px' }}>Quý 1</th>
                          <th style={{ textAlign: 'right', minWidth: '130px' }}>Quý 2</th>
                          <th style={{ textAlign: 'right', minWidth: '130px' }}>Quý 3</th>
                          <th style={{ textAlign: 'right', minWidth: '130px' }}>Quý 4</th>
                          <th style={{ textAlign: 'right', minWidth: '150px', background: 'rgba(37, 99, 235, 0.08)' }}>CẢ NĂM {matrixYear}</th>
                          <th style={{ textAlign: 'center', width: '80px' }}>Subform</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!matrixPayroll?.indicators || matrixPayroll.indicators.length === 0) ? (
                          <tr>
                            <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-tertiary)' }}>
                              Chưa có dữ liệu chi phí lương năm {matrixYear}
                            </td>
                          </tr>
                        ) : (
                          matrixPayroll.indicators.map((ind: any, idx: number) => {
                            const isCount = ind.is_count
                            const fmt = (v: number) => isCount ? `${v} NS` : formatFullCurrency(v || 0)
                            const rowClass = ind.is_highlight ? 'matrix-row-highlight' : ind.is_header ? 'matrix-row-header' : ind.is_sub ? 'matrix-row-sub' : ''
                            
                            return (
                              <tr key={ind.code || idx} className={rowClass}>
                                <td style={{ fontWeight: ind.is_highlight || ind.is_header ? 700 : 500 }}>
                                  {ind.name}
                                </td>
                                <td
                                  className="matrix-cell-interactive"
                                  style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                  title="Nhấp để xem chi tiết chứng từ Quý 1 ở Subform"
                                  onClick={() => openSubform({
                                    title: `Chi tiết bảng lương Quý 1/${matrixYear}`,
                                    subtitle: ind.name + ` - ${fmt(ind.q1)}`,
                                    tag: 'Quý 1',
                                    columns: PAYROLL_DRILLDOWN_COLUMNS,
                                    data: matrixPayroll.quarter_details?.Q1 || [],
                                    filterFields: PAYROLL_FILTER_FIELDS,
                                  })}
                                >
                                  {fmt(ind.q1)}
                                </td>
                                <td
                                  className="matrix-cell-interactive"
                                  style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                  title="Nhấp để xem chi tiết chứng từ Quý 2 ở Subform"
                                  onClick={() => openSubform({
                                    title: `Chi tiết bảng lương Quý 2/${matrixYear}`,
                                    subtitle: ind.name + ` - ${fmt(ind.q2)}`,
                                    tag: 'Quý 2',
                                    columns: PAYROLL_DRILLDOWN_COLUMNS,
                                    data: matrixPayroll.quarter_details?.Q2 || [],
                                    filterFields: PAYROLL_FILTER_FIELDS,
                                  })}
                                >
                                  {fmt(ind.q2)}
                                </td>
                                <td
                                  className="matrix-cell-interactive"
                                  style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                  title="Nhấp để xem chi tiết chứng từ Quý 3 ở Subform"
                                  onClick={() => openSubform({
                                    title: `Chi tiết bảng lương Quý 3/${matrixYear}`,
                                    subtitle: ind.name + ` - ${fmt(ind.q3)}`,
                                    tag: 'Quý 3',
                                    columns: PAYROLL_DRILLDOWN_COLUMNS,
                                    data: matrixPayroll.quarter_details?.Q3 || [],
                                    filterFields: PAYROLL_FILTER_FIELDS,
                                  })}
                                >
                                  {fmt(ind.q3)}
                                </td>
                                <td
                                  className="matrix-cell-interactive"
                                  style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                  title="Nhấp để xem chi tiết chứng từ Quý 4 ở Subform"
                                  onClick={() => openSubform({
                                    title: `Chi tiết bảng lương Quý 4/${matrixYear}`,
                                    subtitle: ind.name + ` - ${fmt(ind.q4)}`,
                                    tag: 'Quý 4',
                                    columns: PAYROLL_DRILLDOWN_COLUMNS,
                                    data: matrixPayroll.quarter_details?.Q4 || [],
                                    filterFields: PAYROLL_FILTER_FIELDS,
                                  })}
                                >
                                  {fmt(ind.q4)}
                                </td>
                                <td
                                  className="matrix-cell-interactive"
                                  style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, background: 'rgba(37, 99, 235, 0.04)' }}
                                  title="Nhấp để xem toàn bộ chứng từ cả năm ở Subform"
                                  onClick={() => openSubform({
                                    title: `Tổng hợp bảng lương cả năm ${matrixYear}`,
                                    subtitle: ind.name + ` - ${fmt(ind.total)}`,
                                    tag: 'Cả năm',
                                    columns: PAYROLL_DRILLDOWN_COLUMNS,
                                    data: matrixPayroll.quarter_details?.ALL || [],
                                    filterFields: PAYROLL_FILTER_FIELDS,
                                  })}
                                >
                                  {fmt(ind.total)}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="btn btn-icon btn-sm btn-secondary"
                                    title="Xem chi tiết các kỳ lương này ở subform bên cạnh"
                                    onClick={() => openSubform({
                                      title: `Chi tiết: ${ind.name}`,
                                      subtitle: `Năm ${matrixYear} - Tổng giá trị: ${fmt(ind.total)}`,
                                      tag: 'Ma trận',
                                      columns: PAYROLL_DRILLDOWN_COLUMNS,
                                      data: matrixPayroll.quarter_details?.ALL || [],
                                      filterFields: PAYROLL_FILTER_FIELDS,
                                    })}
                                  >
                                    <Eye size={16} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  ) : matrixViewMode === 'store' ? (
                    /* ------------------------------------------------------------- */
                    /* BẢNG 2: MA TRẬN CHI PHÍ LƯƠNG THEO CHI NHÁNH & QUÝ           */
                    /* ------------------------------------------------------------- */
                    <table className="matrix-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', minWidth: '220px' }}>Cơ sở / Chi nhánh</th>
                          <th style={{ textAlign: 'center', width: '80px' }}>Mã</th>
                          <th style={{ textAlign: 'right', minWidth: '120px' }}>Quý 1 (Net)</th>
                          <th style={{ textAlign: 'right', minWidth: '120px' }}>Quý 2 (Net)</th>
                          <th style={{ textAlign: 'right', minWidth: '120px' }}>Quý 3 (Net)</th>
                          <th style={{ textAlign: 'right', minWidth: '120px' }}>Quý 4 (Net)</th>
                          <th style={{ textAlign: 'right', minWidth: '140px', background: 'rgba(37, 99, 235, 0.08)' }}>TỔNG NET NĂM</th>
                          <th style={{ textAlign: 'right', minWidth: '140px' }}>Tổng Gross</th>
                          <th style={{ textAlign: 'center', width: '90px' }}>Nhân sự</th>
                          <th style={{ textAlign: 'center', width: '80px' }}>Subform</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!matrixByStore?.rows || matrixByStore.rows.length === 0) ? (
                          <tr>
                            <td colSpan={10} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-tertiary)' }}>
                              Chưa có dữ liệu chi nhánh năm {matrixYear}
                            </td>
                          </tr>
                        ) : (
                          matrixByStore.rows.map((row: any) => (
                            <tr key={row.store_id}>
                              <td style={{ fontWeight: 600 }}>{row.store_name}</td>
                              <td style={{ textAlign: 'center' }}>
                                <span className="badge badge-secondary" style={{ fontSize: '11px' }}>{row.store_code || 'HQ'}</span>
                              </td>
                              <td
                                className="matrix-cell-interactive"
                                style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                onClick={() => openSubform({
                                  title: `Chi phí lương Quý 1 - ${row.store_name}`,
                                  subtitle: `Năm ${matrixYear}`,
                                  tag: 'Chi nhánh',
                                  columns: PAYROLL_DRILLDOWN_COLUMNS,
                                  data: (row.details || []).filter((p: any) => ['2026-01', '2026-02', '2026-03'].includes(p.salary_period)),
                                  filterFields: PAYROLL_FILTER_FIELDS,
                                })}
                              >
                                {formatFullCurrency(row.q1_net)}
                              </td>
                              <td
                                className="matrix-cell-interactive"
                                style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                onClick={() => openSubform({
                                  title: `Chi phí lương Quý 2 - ${row.store_name}`,
                                  subtitle: `Năm ${matrixYear}`,
                                  tag: 'Chi nhánh',
                                  columns: PAYROLL_DRILLDOWN_COLUMNS,
                                  data: (row.details || []).filter((p: any) => ['2026-04', '2026-05', '2026-06'].includes(p.salary_period)),
                                  filterFields: PAYROLL_FILTER_FIELDS,
                                })}
                              >
                                {formatFullCurrency(row.q2_net)}
                              </td>
                              <td
                                className="matrix-cell-interactive"
                                style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                onClick={() => openSubform({
                                  title: `Chi phí lương Quý 3 - ${row.store_name}`,
                                  subtitle: `Năm ${matrixYear}`,
                                  tag: 'Chi nhánh',
                                  columns: PAYROLL_DRILLDOWN_COLUMNS,
                                  data: (row.details || []).filter((p: any) => ['2026-07', '2026-08', '2026-09'].includes(p.salary_period)),
                                  filterFields: PAYROLL_FILTER_FIELDS,
                                })}
                              >
                                {formatFullCurrency(row.q3_net)}
                              </td>
                              <td
                                className="matrix-cell-interactive"
                                style={{ textAlign: 'right', fontFamily: 'monospace' }}
                                onClick={() => openSubform({
                                  title: `Chi phí lương Quý 4 - ${row.store_name}`,
                                  subtitle: `Năm ${matrixYear}`,
                                  tag: 'Chi nhánh',
                                  columns: PAYROLL_DRILLDOWN_COLUMNS,
                                  data: (row.details || []).filter((p: any) => ['2026-10', '2026-11', '2026-12'].includes(p.salary_period)),
                                  filterFields: PAYROLL_FILTER_FIELDS,
                                })}
                              >
                                {formatFullCurrency(row.q4_net)}
                              </td>
                              <td
                                className="matrix-cell-interactive"
                                style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: CHART_COLORS.success, background: 'rgba(37, 99, 235, 0.04)' }}
                                onClick={() => openSubform({
                                  title: `Tổng hợp nhân sự & lương: ${row.store_name}`,
                                  subtitle: `Năm ${matrixYear} - Tổng Net: ${formatFullCurrency(row.total_net)}`,
                                  tag: 'Chi nhánh',
                                  columns: PAYROLL_DRILLDOWN_COLUMNS,
                                  data: row.details || [],
                                  filterFields: PAYROLL_FILTER_FIELDS,
                                })}
                              >
                                {formatFullCurrency(row.total_net)}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', color: CHART_COLORS.primary }}>
                                {formatFullCurrency(row.total_gross)}
                              </td>
                              <td style={{ textAlign: 'center', fontWeight: 600 }}>
                                {row.employee_count} NS
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-icon btn-sm btn-secondary"
                                  title="Xem chi tiết nhân sự chi nhánh này ở subform bên cạnh"
                                  onClick={() => openSubform({
                                    title: `Nhân sự & Bảng lương: ${row.store_name}`,
                                    subtitle: `Năm ${matrixYear} (${row.employee_count} nhân sự)`,
                                    tag: 'Chi nhánh',
                                    columns: PAYROLL_DRILLDOWN_COLUMNS,
                                    data: row.details || [],
                                    filterFields: PAYROLL_FILTER_FIELDS,
                                  })}
                                >
                                  <Eye size={16} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    /* ------------------------------------------------------------- */
                    /* BẢNG 3: MA TRẬN THU NHẬP THEO NHÂN VIÊN & QUÝ / NĂM          */
                    /* ------------------------------------------------------------- */
                    <table className="matrix-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'center', width: '50px' }}>STT</th>
                          <th style={{ textAlign: 'left', minWidth: '180px' }}>Nhân viên</th>
                          <th style={{ textAlign: 'left', minWidth: '150px' }}>Cơ sở</th>
                          <th style={{ textAlign: 'left', minWidth: '130px' }}>Chức vụ</th>
                          <th style={{ textAlign: 'right', minWidth: '115px' }}>Quý 1</th>
                          <th style={{ textAlign: 'right', minWidth: '115px' }}>Quý 2</th>
                          <th style={{ textAlign: 'right', minWidth: '115px' }}>Quý 3</th>
                          <th style={{ textAlign: 'right', minWidth: '115px' }}>Quý 4</th>
                          <th style={{ textAlign: 'right', minWidth: '140px', background: 'rgba(37, 99, 235, 0.08)' }}>TỔNG NET NĂM</th>
                          <th style={{ textAlign: 'center', width: '80px' }}>Subform</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!matrixByEmployee?.rows || matrixByEmployee.rows.length === 0) ? (
                          <tr>
                            <td colSpan={10} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-tertiary)' }}>
                              Chưa có dữ liệu nhân viên năm {matrixYear}
                            </td>
                          </tr>
                        ) : (
                          matrixByEmployee.rows.map((emp: any, idx: number) => (
                            <tr key={emp.employee_id}>
                              <td style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>{idx + 1}</td>
                              <td>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.employee_name}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{emp.employee_code}</div>
                              </td>
                              <td>{emp.store_name}</td>
                              <td>{emp.position_name}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatFullCurrency(emp.q1_net)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatFullCurrency(emp.q2_net)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatFullCurrency(emp.q3_net)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatFullCurrency(emp.q4_net)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: CHART_COLORS.success, background: 'rgba(37, 99, 235, 0.04)' }}>
                                {formatFullCurrency(emp.total_net)}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-icon btn-sm btn-secondary"
                                  title="Xem chi tiết các kỳ lương này ở subform bên cạnh"
                                  onClick={() => openSubform({
                                    title: `Lịch sử phiếu lương: ${emp.employee_name}`,
                                    subtitle: `${emp.employee_code} • ${emp.store_name} - Năm ${matrixYear}`,
                                    tag: 'Nhân viên',
                                    columns: PAYROLL_DRILLDOWN_COLUMNS,
                                    data: emp.payrolls || [],
                                    filterFields: PAYROLL_FILTER_FIELDS,
                                  })}
                                >
                                  <Eye size={16} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>

    {/* CỘT PHẢI (SUBFORM PANE): CHI TIẾT DANH SÁCH 1-N (TRƯỢT TỪ PHẢI SANG KHI CLICK) */}
    {isSubformOpen && (
      <div className={`mypayslip-subform-pane ${isClosingSubform ? 'is-closing' : ''}`}>
        <div className="reports-subform-card">
          {/* Header Subform */}
          <div className="reports-subform-header">
            <div>
              <h4 className="reports-subform-title">
                {subformConfig.title}
                {subformConfig.tag && (
                  <span className="badge badge-primary" style={{ fontSize: '11px', padding: '2px 8px' }}>
                    {subformConfig.tag}
                  </span>
                )}
              </h4>
              {subformConfig.subtitle && (
                <p className="reports-subform-subtitle">{subformConfig.subtitle}</p>
              )}
            </div>
            <button
              type="button"
              className="reports-subform-close"
              onClick={closeSubform}
              title="Đóng chi tiết (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Toolbar Tìm kiếm & Lọc nâng cao */}
          <div className="reports-subform-toolbar">
            <div className="reports-subform-search-row">
              <div className="reports-subform-input-wrap">
                <span className="reports-subform-search-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Tìm nhanh theo từ khóa..."
                  value={subformSearch}
                  onChange={(e) => setSubformSearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={`reports-adv-trigger-btn ${subformConditions.length > 0 || isAdvFilterExpanded ? 'has-active' : ''}`}
                onClick={() => setIsAdvFilterExpanded(!isAdvFilterExpanded)}
                title="Mở bộ lọc tìm kiếm chi tiết trực tiếp trong bảng"
              >
                <Filter size={14} />
                <span>Bộ lọc chi tiết</span>
                {subformConditions.length > 0 && (
                  <span className="reports-adv-badge">{subformConditions.length}</span>
                )}
              </button>
            </div>

            {/* Thanh lọc nhanh theo Dropdown danh mục thực tế (Cơ sở / Chi nhánh từ DB, Chức vụ, Trạng thái...) */}
            {(() => {
              const hasStoreField = subformConfig.filterFields.some((f) => f.key === 'store_name')
              const storeOptions = hasStoreField ? getOptionsForField('store_name') : []

              const hasPositionField = subformConfig.filterFields.some((f) => f.key === 'position_name')
              const positionOptions = hasPositionField ? getOptionsForField('position_name') : []

              const hasEduField = subformConfig.filterFields.some((f) => f.key === 'education_level')
              const eduOptions = hasEduField ? getOptionsForField('education_level') : []

              const statusField = subformConfig.filterFields.find((f) => f.key === 'payment_status' || f.key === 'status_label')
              const statusOptions = statusField ? getOptionsForField(statusField.key) : []

              const hasLeaveType = subformConfig.filterFields.some((f) => f.key === 'type_name')
              const leaveTypeOptions = hasLeaveType ? getOptionsForField('type_name') : []

              if (!hasStoreField && positionOptions.length <= 1 && eduOptions.length <= 1 && statusOptions.length <= 1 && leaveTypeOptions.length <= 1) {
                return null
              }

              return (
                <div className="reports-quick-dropdowns-bar">
                  {hasStoreField && (
                    <div className="reports-quick-select-wrap">
                      <span className="reports-quick-select-label">Cơ sở / Chi nhánh:</span>
                      <select
                        className={`reports-quick-select ${getActiveFilterValue('store_name') ? 'active' : ''}`}
                        value={getActiveFilterValue('store_name')}
                        onChange={(e) => handleQuickDropdownFilter('store_name', e.target.value)}
                      >
                        <option value="">Tất cả chi nhánh ({stores.length || storeOptions.length})</option>
                        {storeOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {hasPositionField && positionOptions.length > 1 && (
                    <div className="reports-quick-select-wrap">
                      <span className="reports-quick-select-label">Chức vụ:</span>
                      <select
                        className={`reports-quick-select ${getActiveFilterValue('position_name') ? 'active' : ''}`}
                        value={getActiveFilterValue('position_name')}
                        onChange={(e) => handleQuickDropdownFilter('position_name', e.target.value)}
                      >
                        <option value="">Tất cả chức vụ ({positionOptions.length})</option>
                        {positionOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {hasEduField && eduOptions.length > 1 && (
                    <div className="reports-quick-select-wrap">
                      <span className="reports-quick-select-label">Học vấn:</span>
                      <select
                        className={`reports-quick-select ${getActiveFilterValue('education_level') ? 'active' : ''}`}
                        value={getActiveFilterValue('education_level')}
                        onChange={(e) => handleQuickDropdownFilter('education_level', e.target.value)}
                      >
                        <option value="">Tất cả học vấn ({eduOptions.length})</option>
                        {eduOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {statusField && statusOptions.length > 1 && (
                    <div className="reports-quick-select-wrap">
                      <span className="reports-quick-select-label">{statusField.label}:</span>
                      <select
                        className={`reports-quick-select ${getActiveFilterValue(statusField.key) ? 'active' : ''}`}
                        value={getActiveFilterValue(statusField.key)}
                        onChange={(e) => handleQuickDropdownFilter(statusField.key, e.target.value)}
                      >
                        <option value="">Tất cả {statusField.label.toLowerCase()} ({statusOptions.length})</option>
                        {statusOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {hasLeaveType && leaveTypeOptions.length > 1 && (
                    <div className="reports-quick-select-wrap">
                      <span className="reports-quick-select-label">Loại nghỉ:</span>
                      <select
                        className={`reports-quick-select ${getActiveFilterValue('type_name') ? 'active' : ''}`}
                        value={getActiveFilterValue('type_name')}
                        onChange={(e) => handleQuickDropdownFilter('type_name', e.target.value)}
                      >
                        <option value="">Tất cả loại nghỉ ({leaveTypeOptions.length})</option>
                        {leaveTypeOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* BỘ LỌC TÌM KIẾM CHI TIẾT INLINE DÀNH CHO NGƯỜI DÙNG PHỔ THÔNG (KHÔNG DÙNG MODAL) */}
            {isAdvFilterExpanded && (
              <div className="reports-inline-filter-box">
                <div className="reports-inline-filter-header">
                  <span className="reports-inline-filter-title">
                    <Filter size={13} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '4px' }} />
                    Bộ lọc chi tiết ({subformConfig.title})
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={handleAddInlineCondition}
                    >
                      + Thêm điều kiện
                    </button>
                    {subformConditions.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--status-error)' }}
                        onClick={() => setSubformConditions([])}
                      >
                        Xóa tất cả
                      </button>
                    )}
                  </div>
                </div>

                <div className="reports-inline-conditions-list">
                  {subformConditions.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center', padding: '10px 0' }}>
                      Chưa có điều kiện nào. Bấm <strong>"+ Thêm điều kiện"</strong> để lọc theo học vấn, chức vụ, mức lương...
                    </div>
                  ) : (
                    subformConditions.map((cond, idx) => {
                      const curField = subformConfig.filterFields.find((f) => f.key === cond.fieldKey) || subformConfig.filterFields[0]
                      const operators = getFriendlyOperatorsForType(curField?.type || 'string')
                      const availableOptions = getOptionsForField(cond.fieldKey)
                      const isSelectInput = curField?.type === 'select' || (availableOptions.length > 0 && curField?.type !== 'number' && curField?.type !== 'date')

                      return (
                        <div key={cond.id || idx} className="reports-inline-condition-row">
                          {idx === 0 ? (
                            <span className="reports-inline-seq-label">ĐIỀU KIỆN 1</span>
                          ) : (
                            <select
                              className="reports-inline-logic-select"
                              value={cond.logic}
                              onChange={(e) => handleUpdateInlineCondition(idx, { logic: e.target.value as 'AND' | 'OR' })}
                            >
                              <option value="AND">Và (Đồng thời)</option>
                              <option value="OR">Hoặc (Một trong hai)</option>
                            </select>
                          )}

                          <label className="reports-inline-not-label" title="Đảo ngược điều kiện (Ngoại trừ)">
                            <input
                              type="checkbox"
                              checked={!!cond.isNot}
                              onChange={(e) => handleUpdateInlineCondition(idx, { isNot: e.target.checked })}
                            />
                            <span>Ngoại trừ</span>
                          </label>

                          <select
                            className="form-control"
                            style={{ fontSize: '12px', padding: '4px 8px', minWidth: '130px' }}
                            value={cond.fieldKey}
                            onChange={(e) => handleInlineFieldChange(idx, e.target.value)}
                          >
                            {subformConfig.filterFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>

                          <select
                            className="form-control"
                            style={{ fontSize: '12px', padding: '4px 8px', minWidth: '135px' }}
                            value={cond.operator}
                            onChange={(e) => handleUpdateInlineCondition(idx, { operator: e.target.value as any })}
                          >
                            {operators.map((op) => (
                              <option key={op.value} value={op.value}>
                                {op.label}
                              </option>
                            ))}
                          </select>

                          {/* Chọn giá trị thực tế có trong bảng thay vì nhập tay thủ công */}
                          {isSelectInput ? (
                            <select
                              className="form-control"
                              style={{
                                fontSize: '12px',
                                padding: '4px 8px',
                                flex: 1,
                                minWidth: '150px',
                                fontWeight: cond.value ? 600 : 400,
                                borderColor: cond.value ? 'var(--brand-primary, #2563eb)' : undefined,
                              }}
                              value={cond.value}
                              onChange={(e) => handleUpdateInlineCondition(idx, { value: e.target.value })}
                            >
                              <option value="">-- Chọn {curField?.label} ({availableOptions.length} mục có trong bảng) --</option>
                              {availableOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : curField?.type === 'number' ? (
                            <input
                              type="number"
                              className="form-control"
                              style={{ fontSize: '12px', padding: '4px 8px', flex: 1, minWidth: '110px' }}
                              placeholder={curField?.placeholder || 'Nhập số...'}
                              value={cond.value}
                              onChange={(e) => handleUpdateInlineCondition(idx, { value: e.target.value })}
                            />
                          ) : curField?.type === 'date' ? (
                            <input
                              type="date"
                              className="form-control"
                              style={{ fontSize: '12px', padding: '4px 8px', flex: 1, minWidth: '120px' }}
                              value={cond.value}
                              onChange={(e) => handleUpdateInlineCondition(idx, { value: e.target.value })}
                            />
                          ) : (
                            <input
                              type="text"
                              className="form-control"
                              style={{ fontSize: '12px', padding: '4px 8px', flex: 1, minWidth: '110px' }}
                              placeholder={curField?.placeholder || 'Nhập từ khóa cần lọc...'}
                              value={cond.value}
                              onChange={(e) => handleUpdateInlineCondition(idx, { value: e.target.value })}
                            />
                          )}

                          <button
                            type="button"
                            className="reports-inline-del-btn"
                            title="Xóa dòng điều kiện này"
                            onClick={() => handleRemoveInlineCondition(idx)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* Chips tóm tắt điều kiện đang lọc dễ hiểu cho người dùng */}
            {subformConditions.length > 0 && (
              <div className="reports-active-chips-bar">
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>Bộ lọc đang áp dụng:</span>
                {subformConditions.map((cond, idx) => {
                  const f = subformConfig.filterFields.find((field) => field.key === cond.fieldKey)
                  const opList = getFriendlyOperatorsForType(f?.type || 'string')
                  const opLabel = opList.find((o) => o.value === cond.operator)?.label || cond.operator
                  let displayVal = cond.value || '...'
                  if (cond.fieldKey === 'payment_status') {
                    if (cond.value === 'PAID') displayVal = 'Đã chi trả'
                    else if (cond.value === 'CONFIRMED') displayVal = 'Đã duyệt'
                    else if (cond.value === 'DRAFT') displayVal = 'Bản nháp'
                  }
                  return (
                    <span key={cond.id || idx} className="reports-active-chip">
                      {idx > 0 && <strong>{cond.logic === 'AND' ? 'VÀ' : 'HOẶC'}</strong>}
                      {cond.isNot && <span style={{ color: 'var(--status-error)', fontWeight: 700 }}>NGOẠI TRỪ</span>}
                      <span>
                        {f?.label || cond.fieldKey}: <em>{opLabel}</em> "{displayVal}"
                      </span>
                      <button
                        type="button"
                        className="reports-chip-remove-btn"
                        onClick={() => handleRemoveInlineCondition(idx)}
                        title="Bỏ điều kiện này"
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary-color)',
                    fontSize: '11.5px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '2px 4px',
                  }}
                  onClick={() => setSubformConditions([])}
                >
                  Xóa lọc
                </button>
              </div>
            )}
          </div>

          {/* Bảng dữ liệu con (Subform Table) */}
          <div className="reports-subform-table-wrap">
            {filteredSubformData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-tertiary)' }}>
                Không tìm thấy bản ghi nào phù hợp với điều kiện tìm kiếm.
              </div>
            ) : (
              <table className="reports-subform-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>STT</th>
                    {subformConfig.columns.map((col) => (
                      <th key={col.key} style={{ textAlign: col.align || 'left', width: col.width }}>
                        {col.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSubformData.map((row, idx) => (
                    <tr key={row.employee_id || row.payroll_id || row.attendance_id || row.leave_id || idx}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>{idx + 1}</td>
                      {subformConfig.columns.map((col) => (
                        <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                          {col.render ? col.render(row) : (row[col.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer Subform */}
          <div className="reports-subform-footer">
            <span>Hiển thị <strong>{filteredSubformData.length}</strong> / {subformConfig.data?.length || 0} bản ghi</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '11.5px', padding: '4px 10px' }}
              onClick={handleExportSubformData}
              title="Tải xuống toàn bộ dữ liệu chi tiết trong bảng dưới định dạng CSV/Excel"
            >
              Xuất dữ liệu Excel (CSV)
            </button>
          </div>
        </div>
      </div>
    )}
  </div>

  {/* Modal In & Xuất PDF A4 */}
  <ReportsPrintModal
    isOpen={isPrintModalOpen}
    onClose={() => setIsPrintModalOpen(false)}
    period={period}
    stats={dashboardStats}
    demographics={demographics}
    payrollFund={payrollFund}
    attendance={attendanceSummary}
    sales={salesReport}
    monthlyStatus={monthlyStatus}
    currentUser={user}
    leaveSummary={leaveSummary}
  />
</div>
  )
}

