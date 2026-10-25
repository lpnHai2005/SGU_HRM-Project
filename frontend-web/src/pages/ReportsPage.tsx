import { useState, useEffect, useMemo } from 'react'
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

// Phạm vi dự án HRM: Tập trung vào Nhân sự, Quỹ lương và Chấm công (Doanh số tạm ẩn)
type ReportTab = 'demographics' | 'payroll' | 'attendance'

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
  const [period, setPeriod] = useState<string>('2026-09')
  const [stores, setStores] = useState<any[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<number | undefined>(undefined)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false)
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false)
  const [drilldownConfig, setDrilldownConfig] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    tag?: string;
    columns: DrilldownColumn[];
    data: any[];
  }>({
    isOpen: false,
    title: '',
    columns: [],
    data: [],
  })

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
    setDrilldownConfig({
      isOpen: true,
      title: `Chi tiết đơn nghỉ phép: ${typeName}`,
      subtitle: `Kỳ ${period} - Tổng cộng ${entry.value || entry.days || 0} ngày nghỉ (${filtered.length} đơn)`,
      tag: 'Nghỉ phép',
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

    setDrilldownConfig({
      isOpen: true,
      title: `Chi tiết lượt chấm công: ${statusLabel || statusVal}`,
      subtitle: `Kỳ ${period} - Ghi nhận ${filtered.length} lượt công`,
      tag: 'Chấm công',
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

  // Xử lý Drilldown khi nhấp vào Biểu đồ Học vấn
  const handleEducationBarClick = (entry: any) => {
    if (!entry) return
    const levelName = entry.level_name || entry.education_level || entry.name
    const detailsList = Array.isArray(demographics?.details) ? demographics.details : []
    const filtered = detailsList.filter((d: any) => d.education_level === levelName)
    setDrilldownConfig({
      isOpen: true,
      title: `Danh sách nhân sự: ${levelName}`,
      subtitle: `Tổng cộng ${filtered.length} nhân sự có trình độ này`,
      tag: 'Trình độ học vấn',
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
    setDrilldownConfig({
      isOpen: true,
      title: `Danh sách nhân sự: Thâm niên ${groupName}`,
      subtitle: `Tổng cộng ${filtered.length} nhân sự`,
      tag: 'Thâm niên công tác',
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
          render: (r: any) => <span>{r.seniority_years} năm</span>,
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
    setDrilldownConfig({
      isOpen: true,
      title: `Danh sách nhân sự: Mức lương ${bracketName}`,
      subtitle: `Tổng cộng ${filtered.length} nhân sự`,
      tag: 'Khung lương hợp đồng',
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

      {/* Tabs chuyển đổi 3 mảng phân tích nhân sự */}
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

        {/* Tab 4: Hiệu suất & Doanh số - Tạm ẩn theo yêu cầu phạm vi dự án HRM */}
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
                      <p className="chart-card-desc">Lịch sử tiếp nhận tuyển mới và số lượng nhân sự qua các tháng</p>
                    </div>
                  </div>
                  <div className="chart-container-wrapper">
                    {headcountTrend.length === 0 ? (
                      <div className="chart-empty-state">Chưa có dữ liệu lịch sử quân số</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={headcountTrend} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
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
                          />
                          <Area
                            type="monotone"
                            dataKey="hired"
                            name="Tuyển mới"
                            stroke={CHART_COLORS.primary}
                            fillOpacity={1}
                            fill="url(#colorHired)"
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
                          <tr key={s.store_id}>
                            <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{s.store_name}</td>
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
                      <p className="chart-card-desc">So sánh tổng thu nhập Gross, thực nhận Net và chi phí bảo hiểm</p>
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
                          />
                          <Bar
                            dataKey="net_total"
                            name="Thực chi Net"
                            fill={CHART_COLORS.navy}
                            radius={[4, 4, 0, 0]}
                          />
                          <Line
                            type="monotone"
                            dataKey="insurance_total"
                            name="Trích nộp BHXH"
                            stroke={CHART_COLORS.error}
                            strokeWidth={2}
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
                      <p className="chart-card-desc">Tỷ trọng các cấu phần thu nhập, phụ cấp, thưởng và trích nộp</p>
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
                          <tr key={store.store_id || idx}>
                            <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                            <td style={{ fontWeight: 600 }}>{store.store_name}</td>
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
          {/* TAB 4: HIỆU SUẤT & DOANH SỐ (ĐÃ ẨN THEO YÊU CẦU PHẠM VI DỰ ÁN HRM THUẦN TÚY) */}
          {/* ========================================================================= */}
        </>
      )}

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

      {/* Modal Drill-down chi tiết danh sách nhân sự & chứng từ khi nhấp vào biểu đồ */}
      <ReportDrilldownModal
        isOpen={drilldownConfig.isOpen}
        onClose={() => setDrilldownConfig((prev) => ({ ...prev, isOpen: false }))}
        title={drilldownConfig.title}
        subtitle={drilldownConfig.subtitle}
        tag={drilldownConfig.tag}
        columns={drilldownConfig.columns}
        data={drilldownConfig.data}
      />
    </div>
  )
}
