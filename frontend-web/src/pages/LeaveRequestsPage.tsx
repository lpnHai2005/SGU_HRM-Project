import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { EmployeeSearchSelect } from '../components/common/EmployeeSearchSelect'
import { LEAVE_STATUS_LABELS } from '../constants/navigation'
import { formatDate } from '../utils/formatters'
import type { LeaveRequest, LeaveBalance, LeaveType, LeaveRequestCreate, Employee } from '../types'
import { leaveApi, employeeApi } from '../services/api'
import './PayslipPrint.css'
import './LeavePrint.css'

export interface LeaveRequestsPageProps {
  user: any
  personal?: boolean
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'HR_APPROVED':
      return 'active' // green
    case 'STORE_APPROVED':
      return 'badge-blue'
    case 'PENDING':
      return 'pending' // amber
    case 'REJECTED':
      return 'rejected' // red
    case 'CANCELLED':
      return 'badge-gray'
    default:
      return 'pending'
  }
}

function getStatusDisplayLabel(status: string, req?: LeaveRequest | null): string {
  const isChtReq = req?.is_store_manager_request || req?.position_name === 'Cửa hàng trưởng' || (req && !req.store_id)
  switch (status) {
    case 'PENDING':
      return isChtReq ? 'Chờ HR duyệt' : 'Chờ CHT duyệt'
    case 'STORE_APPROVED':
      return 'Chờ HR duyệt'
    case 'HR_APPROVED':
      return 'Đã duyệt'
    case 'REJECTED':
      return req?.hr_approved_at ? 'Đã hủy duyệt' : 'Đã từ chối'
    case 'CANCELLED':
      return 'Đã hủy'
    default:
      return LEAVE_STATUS_LABELS[status] || status
  }
}

function formatMonthDisplay(monthStr: string): string {
  if (!monthStr) return ''
  const parts = monthStr.split('-')
  if (parts.length === 2) {
    const [y, m] = parts
    return `${m}-${y}`
  }
  return monthStr
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function parseAttachmentUrls(rawUrl?: string | null): {
  cloudinaryUrls: string[]
  cloudinaryUrl: string | null
  driveUrl: string | null
} {
  if (!rawUrl) return { cloudinaryUrls: [], cloudinaryUrl: null, driveUrl: null }
  const parts = rawUrl.split('|').map(s => s.trim()).filter(Boolean)
  const cloudinaryUrls: string[] = []
  let driveUrl: string | null = null

  for (const p of parts) {
    if (p.includes('cloudinary.com') || /\.(jpe?g|png|webp|gif|bmp|svg|pdf)($|\?)/i.test(p)) {
      cloudinaryUrls.push(p)
    } else if (!driveUrl) {
      driveUrl = p
    } else {
      cloudinaryUrls.push(p)
    }
  }

  if (cloudinaryUrls.length === 0 && !driveUrl && parts.length > 0) {
    driveUrl = parts[0]
  }

  return {
    cloudinaryUrls,
    cloudinaryUrl: cloudinaryUrls[0] || null,
    driveUrl,
  }
}

function getCloudinaryDisplayUrl(url?: string | null): string {
  if (!url) return ''
  // Nếu là tệp PDF lưu trên Cloudinary (/image/upload/ hoặc đuôi .pdf),
  // tự động chuyển đổi phần mở rộng sang .jpg để Cloudinary render trang xem trước,
  // tránh lỗi 401 deny or ACL failure của Cloudinary đối với direct .pdf delivery
  if (url.includes('cloudinary.com') && /\.pdf($|\?)/i.test(url)) {
    return url.replace(/\.pdf($|\?)/i, '.jpg$1')
  }
  return url
}

interface LocalProofFile {
  id: string
  file: File
  previewUrl: string
  name: string
  size: number
  isImage: boolean
}

export function LeaveRequestsPage({ user, personal = false }: LeaveRequestsPageProps) {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null)
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [leaveStats, setLeaveStats] = useState<any>(null)
  const [calendarLeaves, setCalendarLeaves] = useState<LeaveRequest[]>([])

  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'calendar'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all')
  const [calendarMonth, setCalendarMonth] = useState<string>(new Date().toISOString().slice(0, 7))
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [detailModalRequest, setDetailModalRequest] = useState<LeaveRequest | null>(null)
  const [printModalRequest, setPrintModalRequest] = useState<LeaveRequest | null>(null)
  const [selectedDayLeavesModal, setSelectedDayLeavesModal] = useState<{ dateStr: string; leaves: LeaveRequest[] } | null>(null)
  const [storeApproveModalRequest, setStoreApproveModalRequest] = useState<LeaveRequest | null>(null)
  const [hrApproveModalRequest, setHrApproveModalRequest] = useState<LeaveRequest | null>(null)
  const [rejectModalRequest, setRejectModalRequest] = useState<LeaveRequest | null>(null)

  // Form states
  const [employeeList, setEmployeeList] = useState<Employee[]>([])
  const [selectedEmpBalance, setSelectedEmpBalance] = useState<LeaveBalance | null>(null)
  const [loadingEmployees, setLoadingEmployees] = useState(false)

  // Selected local proof files (max 5) & drive link states
  const [selectedProofFiles, setSelectedProofFiles] = useState<LocalProofFile[]>([])
  const [manualDriveLink, setManualDriveLink] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [newRequest, setNewRequest] = useState<LeaveRequestCreate>({
    employee_id: null,
    leave_type_id: 1,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    total_days: 1.0,
    reason: '',
    attachment_url: '',
  })
  const [storeManagerNote, setStoreManagerNote] = useState('Cửa hàng trưởng đã kiểm tra ca kíp và duyệt sơ bộ.')
  const [rejectionReason, setRejectionReason] = useState('')

  // Roles determination
  const userRoles = useMemo(() => user?.roles || [], [user])
  const canManageLeaves = useMemo(() => {
    return userRoles.includes('ADMIN') || userRoles.includes('HR_MANAGER') || userRoles.includes('STORE_MANAGER')
  }, [userRoles])

  // Giao diện cá nhân: Khi có cờ personal=true HOẶC khi là nhân viên bình thường (không có quyền quản lý)
  const isPersonalView = personal || !canManageLeaves

  const isAdmin = !isPersonalView && userRoles.includes('ADMIN')
  const isHrManager = !isPersonalView && userRoles.includes('HR_MANAGER')
  const isStoreManager = !isPersonalView && userRoles.includes('STORE_MANAGER')

  // Leave balances and limits
  const annualTotal = leaveBalance?.annual_leave_total ?? 12
  const annualRemaining = leaveBalance?.annual_leave_remaining ?? 12
  const annualUsed = leaveBalance?.annual_leave_used ?? 0
  const pendingCount = leaveStats?.pending_store_approval ?? leaveRequests.filter(r => r.status === 'PENDING').length

  const selectedEmp = useMemo(() => {
    if (!newRequest.employee_id) return null
    return employeeList.find(e => e.employee_id === newRequest.employee_id) || null
  }, [employeeList, newRequest.employee_id])

  const activeModalBalance = (!isPersonalView && selectedEmpBalance) ? selectedEmpBalance : leaveBalance
  const activeAnnualRemaining = activeModalBalance?.annual_leave_remaining ?? 12
  const activeAnnualTotal = activeModalBalance?.annual_leave_total ?? 12

  const selectedTypeInfo = useMemo(() => {
    return leaveTypes.find(t => t.leave_type_id === newRequest.leave_type_id)
  }, [leaveTypes, newRequest.leave_type_id])

  const handleSelectEmployee = async (empOrId: Employee | number | string | null, empObj?: any) => {
    let numericId: number | null = null
    if (typeof empOrId === 'object' && empOrId !== null) {
      numericId = (empOrId as Employee).employee_id
    } else if (empOrId) {
      numericId = Number(empOrId)
    }
    setNewRequest(prev => ({ ...prev, employee_id: numericId }))
    if (numericId) {
      try {
        const bal = await leaveApi.getEmployeeBalance(numericId)
        setSelectedEmpBalance(bal)
        if (selectedTypeInfo?.type_code === 'PHEP_NAM') {
          const rem = bal.annual_leave_remaining ?? 12
          setNewRequest(prev => ({
            ...prev,
            total_days: prev.total_days > rem ? rem : prev.total_days,
          }))
        }
      } catch (err) {
        console.error('Lỗi khi tra cứu số dư phép nhân viên:', err)
        setSelectedEmpBalance(null)
      }
    } else {
      setSelectedEmpBalance(null)
    }
  }

  const handleProofFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const newFiles = Array.from(files)
    const currentCount = selectedProofFiles.length
    const availableSlots = 5 - currentCount

    if (availableSlots <= 0) {
      showNotification('error', 'Bạn chỉ có thể đính kèm tối đa 5 tệp.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const filesToAdd = newFiles.slice(0, availableSlots)
    if (newFiles.length > availableSlots) {
      showNotification('error', `Chỉ chọn được tối đa 5 tệp. Đã nhận ${availableSlots} tệp hợp lệ.`)
    }

    const validNewLocalFiles: LocalProofFile[] = []
    for (const file of filesToAdd) {
      if (file.size > 10 * 1024 * 1024) {
        showNotification('error', `Tệp "${file.name}" quá lớn (vượt quá 10MB trước khi nén).`)
        continue
      }
      const isImage = file.type.startsWith('image/')
      const previewUrl = URL.createObjectURL(file)
      validNewLocalFiles.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl,
        name: file.name,
        size: file.size,
        isImage,
      })
    }

    if (validNewLocalFiles.length > 0) {
      setSelectedProofFiles(prev => [...prev, ...validNewLocalFiles])
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleRemoveProofFile = (id: string) => {
    setSelectedProofFiles(prev => {
      const target = prev.find(f => f.id === id)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
      }
      return prev.filter(f => f.id !== id)
    })
  }

  const maxAllowedDays = useMemo(() => {
    if (!selectedTypeInfo) return 180
    if (selectedTypeInfo.type_code === 'PHEP_NAM') {
      return activeAnnualRemaining
    }
    if (selectedTypeInfo.max_days_allowed && selectedTypeInfo.max_days_allowed > 0) {
      return Number(selectedTypeInfo.max_days_allowed)
    }
    return 180
  }, [selectedTypeInfo, activeAnnualRemaining])

  // Auto calculate total days when dates change in create modal
  const handleStartDateChange = (val: string) => {
    setNewRequest(prev => {
      let days = prev.total_days
      if (val && prev.end_date) {
        const d1 = new Date(val)
        const d2 = new Date(prev.end_date)
        if (d2 >= d1) {
          days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24)) + 1)
        }
      }
      return { ...prev, start_date: val, total_days: days }
    })
  }

  const handleEndDateChange = (val: string) => {
    setNewRequest(prev => {
      let days = prev.total_days
      if (prev.start_date && val) {
        const d1 = new Date(prev.start_date)
        const d2 = new Date(val)
        if (d2 >= d1) {
          days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24)) + 1)
        }
      }
      return { ...prev, end_date: val, total_days: days }
    })
  }

  // Fetch all leave data
  const fetchLeaveData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [requests, balance, types, stats] = await Promise.all([
        leaveApi.getAll(isPersonalView ? { employee_id: user.employee_id } : undefined),
        leaveApi.getMyBalance(),
        leaveApi.getTypes(),
        isPersonalView ? Promise.resolve(null) : leaveApi.getStats().catch(() => null),
      ])
      setLeaveRequests(isPersonalView ? (requests || []).filter(req => req.employee_id === user.employee_id) : (requests || []))
      setLeaveBalance(balance)
      setLeaveTypes(types || [])
      setLeaveStats(stats)
      if (types && types.length > 0 && !newRequest.leave_type_id) {
        setNewRequest(prev => ({ ...prev, leave_type_id: types[0].leave_type_id }))
      }

      if (!isPersonalView) {
        setLoadingEmployees(true)
        employeeApi.getAll({ status: 'ACTIVE' })
          .then(emps => setEmployeeList(emps || []))
          .catch(err => console.error('Error fetching employees:', err))
          .finally(() => setLoadingEmployees(false))
      }
    } catch (err) {
      console.error('Error fetching leave data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [newRequest.leave_type_id, isPersonalView, user.employee_id])

  // Open Create Modal and optionally preselect employee
  const handleOpenCreateModal = async (targetEmpId?: number) => {
    let activeEmployees = employeeList
    if (!isPersonalView && employeeList.length === 0) {
      setLoadingEmployees(true)
      try {
        const emps = await employeeApi.getAll({ status: 'ACTIVE' })
        activeEmployees = emps || []
        setEmployeeList(activeEmployees)
      } catch (err) {
        console.error('Lỗi tải danh sách nhân viên:', err)
      } finally {
        setLoadingEmployees(false)
      }
    }

    const initialEmpId = targetEmpId ?? (isPersonalView ? (user?.employee_id || null) : null)
    setNewRequest({
      employee_id: initialEmpId,
      leave_type_id: leaveTypes[0]?.leave_type_id || 1,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      total_days: 1.0,
      reason: '',
      attachment_url: '',
    })

    if (!isPersonalView && initialEmpId) {
      try {
        const bal = await leaveApi.getEmployeeBalance(initialEmpId)
        setSelectedEmpBalance(bal)
      } catch {
        setSelectedEmpBalance(null)
      }
    } else {
      setSelectedEmpBalance(null)
    }

    selectedProofFiles.forEach(f => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
    })
    setSelectedProofFiles([])
    setManualDriveLink('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    setIsCreateModalOpen(true)
  }

  // Fetch calendar leaves when calendar tab is active or month changes
  const fetchCalendarData = useCallback(async (month: string) => {
    try {
      const data = await leaveApi.getCalendar({ month, ...(isPersonalView ? { employee_id: user.employee_id } : {}) })
      setCalendarLeaves(isPersonalView ? (data || []).filter(req => req.employee_id === user.employee_id) : (data || []))
    } catch (err) {
      console.error('Error fetching calendar leaves:', err)
      setCalendarLeaves([])
    }
  }, [isPersonalView, user.employee_id])

  useEffect(() => {
    fetchLeaveData()
  }, [fetchLeaveData])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      setOpenMenuId(null)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  useEffect(() => {
    if (activeTab === 'calendar') {
      fetchCalendarData(calendarMonth)
    }
  }, [activeTab, calendarMonth, fetchCalendarData])

  const handlePrevMonth = () => {
    const [y, m] = calendarMonth.split('-').map(Number)
    const prevDate = new Date(y, m - 2, 1)
    const newY = prevDate.getFullYear()
    const newM = String(prevDate.getMonth() + 1).padStart(2, '0')
    setCalendarMonth(`${newY}-${newM}`)
  }

  const handleNextMonth = () => {
    const [y, m] = calendarMonth.split('-').map(Number)
    const nextDate = new Date(y, m, 1)
    const newY = nextDate.getFullYear()
    const newM = String(nextDate.getMonth() + 1).padStart(2, '0')
    setCalendarMonth(`${newY}-${newM}`)
  }

  const handleCurrentMonth = () => {
    setCalendarMonth(new Date().toISOString().slice(0, 7))
  }

  // Danh sách các tháng hiển thị trong dropdown: 1 năm trước tháng hiện tại đến 1 năm sau tháng hiện tại
  const monthOptions = useMemo(() => {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonthNum = now.getMonth() // 0-indexed (0..11)

    const options: Array<{ value: string; label: string }> = []
    // 1 năm trước (-12 tháng) đến 1 năm sau (+12 tháng)
    for (let offset = -12; offset <= 12; offset++) {
      const d = new Date(currentYear, currentMonthNum + offset, 1)
      const y = d.getFullYear()
      const mStr = String(d.getMonth() + 1).padStart(2, '0')
      options.push({
        value: `${y}-${mStr}`,
        label: `Tháng ${mStr}-${y}`,
      })
    }

    // Đảm bảo calendarMonth người dùng đang chọn luôn có trong dropdown (nếu lùi/tiến vượt khoảng)
    if (!options.some((opt) => opt.value === calendarMonth)) {
      const [y, m] = calendarMonth.split('-')
      if (y && m) {
        options.push({
          value: calendarMonth,
          label: `Tháng ${m}-${y}`,
        })
        options.sort((a, b) => a.value.localeCompare(b.value))
      }
    }

    return options
  }, [calendarMonth])

  // Helper mở modal xem chi tiết đơn: luôn tải chi tiết mới nhất kèm thông tin duyệt nếu có
  const handleOpenDetailModal = useCallback(async (req: LeaveRequest) => {
    setDetailModalRequest(req)
    if (req.request_id && req.request_id > 0) {
      try {
        const fullDetail = await leaveApi.getById(req.request_id)
        if (fullDetail) {
          setDetailModalRequest((prev) => {
            if (prev && prev.request_id === req.request_id) {
              return { ...prev, ...fullDetail }
            }
            return prev
          })
        }
      } catch (err) {
        console.error('Error fetching full leave detail:', err)
      }
    }
  }, [])

  // Helper to determine if a record is specifically a resignation / thôi việc (nghỉ việc luôn / chấm dứt HĐLĐ)
  const isResignationRecord = (req: LeaveRequest) => {
    const typeCode = (req.leave_type_code || '').toUpperCase()
    const typeName = (req.leave_type_name || '').toLowerCase()

    // 1. TUYỆT ĐỐI KHÔNG phải là thôi việc/nghỉ luôn nếu là các loại nghỉ phép định kỳ / thông thường:
    if (
      typeCode === 'VIEC_RIENG' ||
      typeCode === 'KHONG_LUONG' ||
      typeCode === 'PHEP_NAM' ||
      typeCode === 'OM_DAU' ||
      typeCode === 'NGHI_OM' ||
      typeCode === 'THAI_SAN' ||
      typeName.includes('việc riêng') ||
      typeName.includes('phép năm') ||
      typeName.includes('ốm đau') ||
      typeName.includes('thai sản')
    ) {
      return false
    }

    // 2. CHỈ ĐƠN THÔI VIỆC / NGHỈ VIỆC HẲN (NGHỈ LUÔN / CHẤM DỨT HĐLĐ) MỚI TÍNH LÀ RESIGNATION:
    if (typeCode === 'THOI_VIEC' || req.leave_type_id === 6) {
      return true
    }
    if (typeName.includes('thôi việc') || typeName.includes('chấm dứt hợp đồng') || typeName.includes('chấm dứt hđlđ')) {
      return true
    }
    if (req.request_id < 0 && typeCode === 'THOI_VIEC') {
      return true
    }

    return false
  }

  // 1. Danh sách nhân sự thôi việc trong tháng (hiển thị riêng ở panel ghi chú)
  const monthResignedEmployees = useMemo(() => {
    const map = new Map<number, LeaveRequest>()
    for (const l of calendarLeaves) {
      if (isResignationRecord(l)) {
        if (!map.has(l.employee_id)) {
          map.set(l.employee_id, l)
        }
      }
    }
    return Array.from(map.values())
  }, [calendarLeaves])

  // 2. Danh sách các đơn nghỉ thông thường trong tháng (loại trừ các nhân viên thôi việc)
  const regularCalendarLeaves = useMemo(() => {
    return calendarLeaves.filter(l => !isResignationRecord(l))
  }, [calendarLeaves])

  // 3. Danh sách đơn nghỉ theo bộ lọc tìm kiếm & loại nghỉ
  const filteredCalendarLeaves = useMemo(() => {
    return regularCalendarLeaves.filter(l => {
      if (selectedTypeFilter !== 'all' && String(l.leave_type_id) !== selectedTypeFilter) {
        return false
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase()
        const empName = l.employee_name?.toLowerCase() || ''
        const empCode = l.employee_code?.toLowerCase() || ''
        const typeName = l.leave_type_name?.toLowerCase() || ''
        const reason = l.reason?.toLowerCase() || ''
        const store = l.store_name?.toLowerCase() || ''
        if (!empName.includes(term) && !empCode.includes(term) && !typeName.includes(term) && !reason.includes(term) && !store.includes(term)) {
          return false
        }
      }
      return true
    })
  }, [regularCalendarLeaves, selectedTypeFilter, searchTerm])

  const calendarDaysMatrix = useMemo(() => {
    const [yearStr, monthStr] = calendarMonth.split('-')
    const year = parseInt(yearStr, 10) || new Date().getFullYear()
    const month = parseInt(monthStr, 10) || (new Date().getMonth() + 1)

    // First day of month (0 = Sun, 1 = Mon, ..., 6 = Sat)
    // Convert to Monday = 0, ..., Sunday = 6
    const firstDay = new Date(year, month - 1, 1).getDay()
    const startingBlankDays = (firstDay + 6) % 7

    // Total days in current month
    const totalDaysInMonth = new Date(year, month, 0).getDate()

    // Total days in previous month
    const prevMonthDays = new Date(year, month - 1, 0).getDate()

    const days: Array<{
      dateStr: string
      dayNumber: number
      isCurrentMonth: boolean
      isToday: boolean
      leaves: LeaveRequest[]
    }> = []

    const todayStr = new Date().toISOString().slice(0, 10)

    // Pad previous month days
    for (let i = startingBlankDays - 1; i >= 0; i--) {
      const d = prevMonthDays - i
      const prevMonth = month === 1 ? 12 : month - 1
      const prevYear = month === 1 ? year - 1 : year
      const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        leaves: filteredCalendarLeaves.filter(l => l.start_date <= dateStr && l.end_date >= dateStr),
      })
    }

    // Current month days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateStr = `${yearStr}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        leaves: filteredCalendarLeaves.filter(l => l.start_date <= dateStr && l.end_date >= dateStr),
      })
    }

    // Pad next month days to fill complete rows of 7
    const remainingDays = (7 - (days.length % 7)) % 7
    for (let d = 1; d <= remainingDays; d++) {
      const nextMonth = month === 12 ? 1 : month + 1
      const nextYear = month === 12 ? year + 1 : year
      const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        leaves: filteredCalendarLeaves.filter(l => l.start_date <= dateStr && l.end_date >= dateStr),
      })
    }

    return days
  }, [calendarMonth, filteredCalendarLeaves])

  // Filter requests
  const filteredRequests = useMemo(() => {
    return leaveRequests.filter(req => {
      // Tab filter
      if (activeTab === 'pending') {
        if (req.status !== 'PENDING' && req.status !== 'STORE_APPROVED') return false
      } else if (activeTab === 'approved') {
        if (req.status !== 'HR_APPROVED') return false
      } else if (activeTab === 'rejected') {
        if (req.status !== 'REJECTED') return false
      }

      // Leave type dropdown filter
      if (selectedTypeFilter !== 'all') {
        if (String(req.leave_type_id) !== selectedTypeFilter) return false
      }

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase()
        const empName = req.employee_name?.toLowerCase() || ''
        const empCode = req.employee_code?.toLowerCase() || ''
        const typeName = req.leave_type_name?.toLowerCase() || ''
        const reason = req.reason?.toLowerCase() || ''
        const store = req.store_name?.toLowerCase() || ''
        if (!empName.includes(term) && !empCode.includes(term) && !typeName.includes(term) && !reason.includes(term) && !store.includes(term)) {
          return false
        }
      }

      return true
    })
  }, [leaveRequests, activeTab, selectedTypeFilter, searchTerm])

  const showNotification = (type: 'success' | 'error', text: string) => {
    setFeedbackMessage({ type, text })
    setTimeout(() => {
      setFeedbackMessage(null)
    }, 5000)
  }

  // Action: Submit Leave Request
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isPersonalView && !newRequest.employee_id) {
      showNotification('error', 'Vui lòng chọn nhân viên cần tạo đơn nghỉ phép.')
      return
    }
    if (newRequest.total_days <= 0) {
      showNotification('error', 'Số ngày xin nghỉ phải lớn hơn 0.')
      return
    }
    if (maxAllowedDays > 0 && newRequest.total_days > maxAllowedDays) {
      showNotification(
        'error',
        `Loại nghỉ '${selectedTypeInfo?.type_name || ''}' chỉ được nghỉ tối đa ${maxAllowedDays} ngày theo quy định. Bạn đang chọn ${newRequest.total_days} ngày!`
      )
      return
    }
    setActionLoading(true)
    try {
      // Tải các tệp lên Cloudinary CHỈ KHI nộp đơn (tối đa 5 tệp)
      const uploadedCloudinaryUrls: string[] = []
      if (selectedProofFiles.length > 0) {
        try {
          for (const item of selectedProofFiles) {
            const uploadRes = await leaveApi.uploadProof(item.file)
            if (uploadRes?.proof_url) {
              uploadedCloudinaryUrls.push(uploadRes.proof_url)
            }
          }
        } catch (uploadErr: any) {
          showNotification('error', uploadErr.response?.data?.detail || uploadErr.message || 'Lỗi khi tải tệp minh chứng lên Cloudinary.')
          setActionLoading(false)
          return
        }
      }

      // Kết hợp các link Cloudinary và link Drive ngoài nếu có
      const cleanDrive = manualDriveLink.trim()
      const allAttachmentLinks = [...uploadedCloudinaryUrls, ...(cleanDrive ? [cleanDrive] : [])]
      const combinedAttachmentUrl: string | null = allAttachmentLinks.length > 0 ? allAttachmentLinks.join(' | ') : null

      const payload: LeaveRequestCreate = {
        ...newRequest,
        employee_id: isPersonalView ? (user?.employee_id || null) : newRequest.employee_id,
        attachment_url: combinedAttachmentUrl || undefined,
      }
      const res = await leaveApi.create(payload)
      showNotification('success', res.message || 'Nộp đơn nghỉ phép thành công!')
      setIsCreateModalOpen(false)

      // Dọn dẹp preview và link sau khi nộp thành công
      selectedProofFiles.forEach(f => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
      })
      setSelectedProofFiles([])
      setManualDriveLink('')
      if (fileInputRef.current) fileInputRef.current.value = ''

      // Reset form
      setNewRequest({
        employee_id: isPersonalView ? (user?.employee_id || null) : null,
        leave_type_id: leaveTypes[0]?.leave_type_id || 1,
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date().toISOString().slice(0, 10),
        total_days: 1.0,
        reason: '',
        attachment_url: '',
      })
      setSelectedEmpBalance(null)
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi khi nộp đơn nghỉ phép')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: Store Manager Level 1 Approve
  const handleStoreApproveSubmit = async () => {
    if (!storeApproveModalRequest) return
    setActionLoading(true)
    try {
      const res = await leaveApi.approveStore(storeApproveModalRequest.request_id, {
        note: storeManagerNote,
      })
      showNotification('success', res.message || 'Duyệt thành công!')
      setStoreApproveModalRequest(null)
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi duyệt đơn')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: HR Manager Level 2 Approve
  const handleHrApproveSubmit = async () => {
    if (!hrApproveModalRequest) return
    setActionLoading(true)
    try {
      const res = await leaveApi.approveHr(hrApproveModalRequest.request_id)
      showNotification('success', res.message || 'Phê duyệt chính thức thành công!')
      setHrApproveModalRequest(null)
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi duyệt đơn')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: Reject Leave Request
  const handleRejectSubmit = async () => {
    if (!rejectModalRequest) return
    if (!rejectionReason.trim()) {
      showNotification('error', 'Vui lòng nhập lý do từ chối đơn!')
      return
    }
    setActionLoading(true)
    try {
      const res = await leaveApi.reject(rejectModalRequest.request_id, {
        rejection_reason: rejectionReason,
      })
      showNotification('success', res.message || 'Đã từ chối đơn nghỉ phép.')
      setRejectModalRequest(null)
      setRejectionReason('')
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi khi từ chối đơn')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: Cancel Leave Request
  const handleCancelRequest = async (requestId: number) => {
    if (!window.confirm('Bạn có chắc chắn muốn hủy đơn xin nghỉ phép này?')) return
    setActionLoading(true)
    try {
      const res = await leaveApi.cancel(requestId)
      showNotification('success', res.message || 'Đã hủy đơn thành công!')
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi khi hủy đơn')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="page-container">
      {/* Toast Notification */}
      {feedbackMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#fff',
            backgroundColor: feedbackMessage.type === 'success' ? '#10b981' : '#ef4444',
            fontWeight: 500,
            animation: 'fadeIn 0.3s ease',
          }}
        >
          {feedbackMessage.type === 'success' ? Icons.checkCircle : Icons.alertCircle}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title">{isPersonalView ? 'Nghỉ Phép & Đơn Của Tôi' : 'Quản lý Nghỉ Phép'}</h1>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.9rem', marginTop: '4px' }}>
            {isPersonalView ? 'Theo dõi số dư phép năm và gửi đơn xin nghỉ phép cá nhân' : 'Theo dõi và phê duyệt đơn xin nghỉ phép nhân sự TechZone'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => handleOpenCreateModal()}>
            {Icons.plus}
            {isPersonalView ? 'Tạo đơn xin nghỉ phép' : 'Tạo đơn cho nhân viên'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stat-grid-4">
        <StatCard
          icon={Icons.calendar}
          iconColor="blue"
          label="Phép năm còn lại"
          value={`${annualRemaining} / ${annualTotal} ngày`}
        />
        <StatCard
          icon={Icons.shield}
          iconColor="green"
          label="Nghỉ ốm đau BHXH"
          value={`${leaveBalance?.sick_leave_used || 0} ngày`}
        />
        <StatCard
          icon={Icons.clock}
          iconColor="amber"
          label={isPersonalView ? 'Đơn đang chờ duyệt' : 'Chờ CHT duyệt'}
          value={`${pendingCount} đơn`}
        />
        <StatCard
          icon={Icons.checkCircle}
          iconColor="green"
          label="Phép năm đã duyệt"
          value={`${annualUsed} ngày`}
        />
      </div>

      {/* Main Content Card */}
      <div className="card">
        {/* Card Header & Tabs (Optimized single-row layout) */}
        <div className="card-header leave-requests-header">
          {/* Tabs */}
          <div
            className="tabs"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: 0,
              borderBottom: 'none',
              padding: 0,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              <span>Tất cả đơn</span>
              <span className="leave-tab-badge">{leaveRequests.length}</span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'pending' ? 'active' : ''}`}
              onClick={() => setActiveTab('pending')}
            >
              <span>Chờ duyệt</span>
              <span className="leave-tab-badge">
                {leaveRequests.filter(r => r.status === 'PENDING' || r.status === 'STORE_APPROVED').length}
              </span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'approved' ? 'active' : ''}`}
              onClick={() => setActiveTab('approved')}
            >
              <span>Đã duyệt</span>
              <span className="leave-tab-badge">
                {leaveRequests.filter(r => r.status === 'HR_APPROVED').length}
              </span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'rejected' ? 'active' : ''}`}
              onClick={() => setActiveTab('rejected')}
            >
              <span>Từ chối</span>
              <span className="leave-tab-badge">
                {leaveRequests.filter(r => r.status === 'REJECTED').length}
              </span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'calendar' ? 'active' : ''}`}
              onClick={() => setActiveTab('calendar')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>{Icons.calendar}</span>
              <span>Lịch nghỉ phép</span>
            </button>
          </div>

          {/* Search & Leave Type Dropdown (Always on the same row) */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              flexShrink: 0,
              marginLeft: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            <div className="search-box" style={{ width: '220px', minWidth: '170px', position: 'relative' }}>
              <span
                className="search-icon"
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              >
                {Icons.search}
              </span>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm nhân viên, mã..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  height: '34px',
                  paddingLeft: '32px',
                  paddingRight: searchTerm ? '28px' : '10px',
                  fontSize: '13px',
                  width: '100%',
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Xóa tìm kiếm"
                >
                  {Icons.close}
                </button>
              )}
            </div>

            <select
              className="form-select"
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              style={{
                height: '34px',
                width: 'auto',
                minWidth: '145px',
                maxWidth: '180px',
                fontSize: '13px',
              }}
            >
              <option value="all">Tất cả loại nghỉ</option>
              {leaveTypes.map((t) => (
                <option key={t.leave_type_id} value={String(t.leave_type_id)}>
                  {t.type_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tab 1: List Table */}
        {activeTab !== 'calendar' ? (
          isLoading ? (
            <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
              Đang tải danh sách đơn nghỉ phép...
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>MÃ ĐƠN</th>
                    <th>NHÂN VIÊN</th>
                    <th>LOẠI NGHỈ</th>
                    <th>THỜI GIAN</th>
                    <th>SỐ NGÀY</th>
                    <th>LÝ DO</th>
                    <th>TRẠNG THÁI</th>
                    <th>CHT DUYỆT</th>
                    <th>HR DUYỆT</th>
                    <th style={{ width: '95px', textAlign: 'center' }}>THAO TÁC</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((req) => {
                    const isOwner = req.employee_id === user?.employee_id
                    const isRejected = req.status === 'REJECTED'
                    const wasHrApprovedBeforeReject = isRejected && !!req.hr_approved_at
                    const isApplicantStoreManager = Boolean(req.is_store_manager_request || req.position_name === 'Cửa hàng trưởng')

                    // Kiểm tra thời gian nghỉ phép đã qua hay chưa (theo ngày hiện tại cục bộ)
                    const now = new Date()
                    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                    const leaveEndDate = req.end_date || req.resignation_date || req.start_date || ''
                    const isLeavePassed = Boolean(leaveEndDate && leaveEndDate < todayStr)

                    // Kiểm tra đơn đã được phê duyệt ở bất kỳ cấp nào hay chưa (Cấp 1 CHT hoặc Cấp 2 HR)
                    const isApprovedAnyLevel = req.status === 'STORE_APPROVED' || req.status === 'HR_APPROVED' || Boolean(req.store_approved_at) || Boolean(req.hr_approved_at)

                    // Cửa hàng trưởng không thể tự duyệt đơn của mình và không duyệt đơn của CHT khác
                    const canStoreApprove = (isStoreManager || isAdmin) && req.status === 'PENDING' && !isOwner && !isApplicantStoreManager

                    // HR có thể duyệt thẳng (Cấp 2) kể cả trước khi Cửa hàng trưởng duyệt Cấp 1
                    const canHrApprove = (isHrManager || isAdmin) && (
                      req.status === 'STORE_APPROVED' || req.status === 'PENDING'
                    ) && (!isOwner || isAdmin)

                    // Nếu đã qua thời gian mà nhân viên xin nghỉ trước đó thì không được hiện chức năng hủy duyệt/ từ chối (do cấp trên thực hiện) nữa
                    const canRejectPending = !isLeavePassed && (
                      (isStoreManager && !isApplicantStoreManager && !isOwner && req.status === 'PENDING') ||
                      ((isHrManager || isAdmin) && (req.status === 'PENDING' || req.status === 'STORE_APPROVED'))
                    )
                    const canRevokeHrApproved = !isLeavePassed && (isHrManager || isAdmin) && req.status === 'HR_APPROVED'

                    // Nếu đã được duyệt bất kì cấp nào thì nhân viên cũng không được tự ý hủy đơn giữa chừng
                    const canCancel = isOwner && req.status === 'PENDING' && !isApprovedAnyLevel
                    const hasAnyAction = true

                    // Kiểm tra bước CHT có áp dụng hay không
                    const isChtStepNotApplicable = isApplicantStoreManager ||
                      Boolean(req.hr_approved_at && !req.store_approved_at) ||
                      Boolean(isRejected && !req.store_approved_at && (req.rejected_by_role === 'Phòng Nhân sự' || req.rejected_by_role === 'Ban Giám đốc / Admin'))

                    return (
                      <tr key={req.request_id}>
                        <td>
                          <span className="table-cell-mono font-bold" style={{ cursor: 'pointer', color: 'var(--primary-color, #2563eb)' }} onClick={() => handleOpenDetailModal(req)}>
                            #{req.request_id}
                          </span>
                        </td>
                        <td>
                          <div>
                            <div style={{ fontWeight: 600 }}>{req.employee_name || `Nhân viên #${req.employee_id}`}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                              {req.employee_code || ''} {req.store_name ? `• ${req.store_name}` : ''}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-blue">
                            {req.leave_type_name || 'N/A'}
                          </span>
                        </td>
                        <td>
                          <div className="table-cell-mono" style={{ fontSize: '0.85rem' }}>
                            {formatDate(req.start_date)} &rarr; {formatDate(req.end_date)}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{req.total_days} ngày</span>
                        </td>
                        <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={req.reason || ''}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {req.attachment_url && (
                              <span
                                title="Có đính kèm minh chứng"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  color: '#2563eb',
                                  flexShrink: 0,
                                }}
                              >
                                {Icons.paperclip}
                              </span>
                            )}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.reason || '-'}</span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`status-pill ${getStatusBadgeClass(req.status)}`}
                            style={
                              isRejected
                                ? {
                                  backgroundColor: '#fef2f2',
                                  color: '#dc2626',
                                  borderColor: '#fca5a5',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  padding: '3px 8px',
                                }
                                : undefined
                            }
                            title={getStatusDisplayLabel(req.status, req)}
                          >
                            {isRejected && <span style={{ color: '#dc2626', fontWeight: 900, fontSize: '0.85rem' }}>✕</span>}
                            {getStatusDisplayLabel(req.status, req)}
                          </span>
                        </td>
                        <td>
                          {/* Cột CHT Duyệt */}
                          {isChtStepNotApplicable ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Không áp dụng</span>
                          ) : isRejected && (req.rejected_by_role === 'Cửa hàng trưởng' || (!req.store_approved_at && req.rejected_by_name && !wasHrApprovedBeforeReject && req.rejected_by_role !== 'Phòng Nhân sự')) ? (
                            <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 900, color: '#dc2626' }}>✕</span>
                                <span>{req.rejected_by_name || 'Cửa hàng trưởng'}</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>
                                CHT từ chối {req.rejected_at ? `(${formatDate(req.rejected_at)})` : ''}
                              </div>
                            </div>
                          ) : req.store_approved_at ? (
                            <div style={{ fontSize: '0.8rem', color: '#10b981' }}>
                              <div>{Icons.check} {req.store_manager_name || 'CHT'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>{formatDate(req.store_approved_at)}</div>
                            </div>
                          ) : isRejected ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Không áp dụng</span>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Chưa duyệt</span>
                          )}
                        </td>
                        <td>
                          {/* Cột HR Duyệt */}
                          {wasHrApprovedBeforeReject ? (
                            <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 900, color: '#dc2626' }}>✕</span>
                                <span>{req.rejected_by_name || 'Phòng Nhân sự'}</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 700 }}>
                                Đã hủy duyệt
                              </div>
                              {req.rejected_at && (
                                <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>
                                  {formatDate(req.rejected_at)}
                                </div>
                              )}
                            </div>
                          ) : isRejected && (req.rejected_by_role === 'Phòng Nhân sự' || req.rejected_by_role === 'Ban Giám đốc / Admin' || req.store_approved_at || isApplicantStoreManager) ? (
                            <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 900, color: '#dc2626' }}>✕</span>
                                <span>{req.rejected_by_name || 'Phòng Nhân sự'}</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>
                                HR từ chối {req.rejected_at ? `(${formatDate(req.rejected_at)})` : ''}
                              </div>
                            </div>
                          ) : isRejected ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Không áp dụng</span>
                          ) : req.hr_approved_at ? (
                            <div style={{ fontSize: '0.8rem', color: '#10b981' }}>
                              <div>{Icons.check} {req.hr_approver_name || 'HR Manager'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>{formatDate(req.hr_approved_at)}</div>
                            </div>
                          ) : req.status === 'STORE_APPROVED' || (req.status === 'PENDING' && isApplicantStoreManager) ? (
                            <span style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 500 }}>Chờ HR duyệt</span>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Chờ duyệt</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', position: 'relative' }}>
                            {/* Nút 1: Xem chi tiết (Mắt) */}
                            <button
                              className="btn btn-secondary btn-sm btn-icon"
                              title="Xem chi tiết đơn"
                              onClick={() => setDetailModalRequest(req)}
                            >
                              {Icons.eye}
                            </button>

                            {/* Nút 2: Tùy chọn thao tác (Dấu 3 chấm) */}
                            <button
                              className="btn btn-secondary btn-sm btn-icon"
                              title={hasAnyAction ? "Tùy chọn thao tác" : "Không có thao tác khác"}
                              disabled={!hasAnyAction}
                              style={{
                                opacity: hasAnyAction ? 1 : 0.4,
                                cursor: hasAnyAction ? 'pointer' : 'not-allowed',
                              }}
                              onClick={(e) => {
                                if (!hasAnyAction) return
                                e.stopPropagation()
                                setOpenMenuId(openMenuId === req.request_id ? null : req.request_id)
                              }}
                            >
                              {Icons.moreVertical}
                            </button>

                            {/* Dropdown Menu thao tác */}
                            {openMenuId === req.request_id && hasAnyAction && (
                              <div
                                className="action-dropdown"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  right: 0,
                                  marginTop: '4px',
                                  zIndex: 80,
                                  minWidth: '195px',
                                }}
                              >
                                <button
                                  className="action-dropdown-item"
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    setPrintModalRequest(req)
                                  }}
                                >
                                  <span className="action-icon" style={{ color: '#2563eb' }}>{Icons.printer}</span>
                                  <span>In đơn nghỉ phép (PDF / A4)</span>
                                </button>

                                {!isPersonalView && (
                                  <button
                                    className="action-dropdown-item"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      handleOpenCreateModal(req.employee_id)
                                    }}
                                  >
                                    <span className="action-icon" style={{ color: '#059669' }}>{Icons.plus}</span>
                                    <span>Tạo đơn hộ nhân viên này</span>
                                  </button>
                                )}

                                {canStoreApprove && (
                                  <button
                                    className="action-dropdown-item"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setStoreApproveModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-promote">{Icons.check}</span>
                                    <span>Duyệt cấp 1 (CHT)</span>
                                  </button>
                                )}

                                {canHrApprove && (
                                  <button
                                    className="action-dropdown-item"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setHrApproveModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-edit">{Icons.check}</span>
                                    <span>Duyệt cấp 2 (HR)</span>
                                  </button>
                                )}

                                {canRejectPending && (
                                  <button
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setRejectModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Từ chối đơn</span>
                                  </button>
                                )}

                                {canRevokeHrApproved && (
                                  <button
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setRejectModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Hủy duyệt & Từ chối</span>
                                  </button>
                                )}

                                {canCancel && (
                                  <button
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      handleCancelRequest(req.request_id)
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Hủy đơn xin nghỉ</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredRequests.length === 0 && (
                    <tr>
                      <td colSpan={10}>
                        <EmptyState
                          icon={Icons.calendar}
                          title="Không tìm thấy đơn nghỉ phép nào"
                          description="Không có yêu cầu nghỉ phép nào phù hợp với bộ lọc tìm kiếm hiện tại."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* Tab 2: Calendar View */
          <div className="card-body" style={{ padding: '24px' }}>
            {/* Top Navigation & Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Lịch Nhân Sự Nghỉ Phép Tháng {formatMonthDisplay(calendarMonth)}
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Theo dõi trực quan lịch vắng mặt theo ngày & chi tiết từng nhân sự đã được duyệt trong tháng {formatMonthDisplay(calendarMonth)}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Nút Hôm nay đứng riêng bên trái */}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  title="Trở về tháng hiện tại"
                  onClick={handleCurrentMonth}
                  style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600, height: '34px' }}
                >
                  Hôm nay
                </button>

                {/* Cụm chuyển tháng: nút lùi [ < ] + Dropdown chọn tháng + nút tiến [ > ] */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title="Tháng trước"
                    onClick={handlePrevMonth}
                    style={{ padding: '6px 10px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {Icons.chevronLeft}
                  </button>

                  <select
                    className="form-select"
                    value={calendarMonth}
                    onChange={(e) => setCalendarMonth(e.target.value)}
                    style={{
                      height: '34px',
                      width: 'auto',
                      minWidth: '150px',
                      fontSize: '13px',
                      fontWeight: 600,
                      padding: '4px 10px',
                    }}
                  >
                    {monthOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title="Tháng sau"
                    onClick={handleNextMonth}
                    style={{ padding: '6px 10px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {Icons.chevronRight}
                  </button>
                </div>
              </div>
            </div>

            {/* Note danh sách nhân sự thôi việc / nghỉ việc trong tháng */}
            <div className="resigned-staff-panel">
              <div className="resigned-staff-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-flex', padding: '6px', borderRadius: '6px', backgroundColor: 'var(--surface-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}>
                    {Icons.users}
                  </span>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Danh Sách Nhân Sự Thôi Việc / Nghỉ Việc Trong Tháng {formatMonthDisplay(calendarMonth)} ({monthResignedEmployees.length})
                    </h4>
                  </div>
                </div>

                {monthResignedEmployees.length > 0 && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--surface-subtle)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    {monthResignedEmployees.length} nhân sự
                  </span>
                )}
              </div>

              {monthResignedEmployees.length === 0 ? (
                <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-subtle)', color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--status-success)' }}>{Icons.checkCircle}</span>
                  <span>Không có nhân sự nào thôi việc hoặc nghỉ việc trong tháng {formatMonthDisplay(calendarMonth)}.</span>
                </div>
              ) : (
                <div className="resigned-staff-grid">
                  {monthResignedEmployees.map((emp) => (
                    <div key={'resigned-' + emp.employee_id + '-' + emp.request_id} className="resigned-staff-card">
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--surface-subtle)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-default)',
                            }}
                          >
                            Đã thôi việc
                          </span>
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {emp.employee_code}
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                          {emp.employee_name}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          {emp.store_name || emp.department_name || 'TechZone'} {emp.position_name ? `• ${emp.position_name}` : ''}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '5px 8px', borderRadius: '4px', marginBottom: '6px' }}>
                          <strong>Ngày thôi việc:</strong> {formatDate(emp.resignation_date || emp.start_date)}
                        </div>
                        {emp.reason && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={emp.reason}>
                            &ldquo;{emp.reason}&rdquo;
                          </div>
                        )}
                      </div>

                      {emp.request_id > 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ marginTop: '10px', width: '100%', justifyContent: 'center', gap: '4px', fontSize: '11.5px', padding: '4px 8px' }}
                          onClick={() => setDetailModalRequest(emp)}
                        >
                          {Icons.eye} Chi tiết đơn thôi việc
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Calendar Matrix (7-day grid) */}
            <div
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: 'var(--surface-card)',
                marginBottom: '28px',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {/* Day of Week Headers */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  borderBottom: '1px solid var(--border-default)',
                  backgroundColor: 'var(--surface-subtle)',
                }}
              >
                {['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'].map((dayName, idx) => (
                  <div
                    key={dayName}
                    style={{
                      padding: '10px 8px',
                      textAlign: 'center',
                      fontSize: '12px',
                      fontWeight: idx === 6 ? 800 : 600,
                      color: idx === 6 ? '#dc2626' : 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderRight: idx < 6 ? '1px solid var(--border-default)' : 'none',
                      backgroundColor: idx === 6 ? 'rgba(239, 68, 68, 0.05)' : undefined,
                    }}
                  >
                    {dayName}
                  </div>
                ))}
              </div>

              {/* Day Cells Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                }}
              >
                {calendarDaysMatrix.map((cell, idx) => {
                  const isSunday = (idx % 7) === 6
                  const hasLeaves = cell.leaves.length > 0

                  return (
                    <div
                      key={cell.dateStr + '-' + idx}
                      className="calendar-day-cell"
                      style={{
                        borderRight: (idx % 7) < 6 ? '1px solid var(--border-default)' : 'none',
                        borderBottom: idx < calendarDaysMatrix.length - 7 ? '1px solid var(--border-default)' : 'none',
                        backgroundColor: !cell.isCurrentMonth
                          ? 'var(--surface-subtle)'
                          : isSunday
                            ? 'rgba(239, 68, 68, 0.03)'
                            : 'var(--surface-card)',
                        opacity: cell.isCurrentMonth ? 1 : 0.45,
                      }}
                    >
                      {/* Day Header with Date Number */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            fontWeight: cell.isToday ? 800 : 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: cell.isToday ? '24px' : 'auto',
                            height: cell.isToday ? '24px' : 'auto',
                            borderRadius: cell.isToday ? '50%' : '0',
                            backgroundColor: cell.isToday ? 'var(--action-primary)' : 'transparent',
                            color: cell.isToday
                              ? 'var(--action-primary-text)'
                              : cell.isCurrentMonth
                                ? 'var(--text-primary)'
                                : 'var(--text-muted)',
                          }}
                        >
                          {cell.dayNumber}
                        </span>

                        {hasLeaves && cell.isCurrentMonth && (
                          <button
                            type="button"
                            onClick={() => setSelectedDayLeavesModal({ dateStr: cell.dateStr, leaves: cell.leaves })}
                            title="Bấm để xem danh sách nhân sự nghỉ trong ngày"
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-primary)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border-default)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <span>{cell.leaves.length}</span>
                            <span style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>nghỉ</span>
                          </button>
                        )}
                      </div>

                      {/* Leaves Badges in Cell (Top 2 leaves) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, overflow: 'hidden' }}>
                        {cell.leaves.slice(0, 2).map((lv) => {
                          const isUnpaid = lv.leave_type_code === 'NGHI_KHONG_LUONG' || lv.leave_type_id === 2
                          const isPaid = lv.leave_type_code === 'PHEP_NAM' || lv.leave_type_id === 1
                          const isSick = lv.leave_type_code === 'OM_DAU' || lv.leave_type_id === 3
                          const isMaternity = lv.leave_type_code === 'THAI_SAN' || lv.leave_type_id === 4

                          let badgeBg = 'rgba(59, 130, 246, 0.1)'
                          let badgeBorder = 'rgba(59, 130, 246, 0.25)'
                          let badgeText = '#2563eb'
                          let dotColor = '#3b82f6'

                          if (isPaid) {
                            badgeBg = 'rgba(16, 185, 129, 0.12)'
                            badgeBorder = 'rgba(16, 185, 129, 0.25)'
                            badgeText = '#059669'
                            dotColor = '#10b981'
                          } else if (isUnpaid) {
                            badgeBg = 'rgba(239, 68, 68, 0.1)'
                            badgeBorder = 'rgba(239, 68, 68, 0.25)'
                            badgeText = '#dc2626'
                            dotColor = '#ef4444'
                          } else if (isSick) {
                            badgeBg = 'rgba(245, 158, 11, 0.12)'
                            badgeBorder = 'rgba(245, 158, 11, 0.25)'
                            badgeText = '#d97706'
                            dotColor = '#f59e0b'
                          } else if (isMaternity) {
                            badgeBg = 'rgba(168, 85, 247, 0.12)'
                            badgeBorder = 'rgba(168, 85, 247, 0.25)'
                            badgeText = '#7e22ce'
                            dotColor = '#a855f7'
                          }

                          return (
                            <div
                              key={'lv-badge-' + lv.request_id}
                              className="calendar-leave-chip"
                              title={`${lv.employee_name} (${lv.employee_code || ''}) - ${lv.leave_type_name}: ${formatDate(lv.start_date)} đến ${formatDate(lv.end_date)}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenDetailModal(lv)
                              }}
                              style={{
                                backgroundColor: badgeBg,
                                border: `1px solid ${badgeBorder}`,
                                color: badgeText,
                              }}
                            >
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {lv.employee_name}
                              </span>
                            </div>
                          )
                        })}

                        {/* Button Xem thêm nếu có nhiều hơn 2 người nghỉ */}
                        {cell.leaves.length > 2 && (
                          <div
                            className="calendar-more-chip"
                            title={`Bấm để xem toàn bộ ${cell.leaves.length} nhân sự nghỉ ngày ${cell.dayNumber}/${calendarMonth.split('-')[1]}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedDayLeavesModal({
                                dateStr: cell.dateStr,
                                leaves: cell.leaves,
                              })
                            }}
                          >
                            <span>+{cell.leaves.length - 2} nhân sự khác</span>
                            <span style={{ fontSize: '10px' }}>&rarr;</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Detailed Cards List */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Danh Sách Đơn Nghỉ Phép Trong Tháng {formatMonthDisplay(calendarMonth)} ({filteredCalendarLeaves.length})
                  </h4>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Hiển thị các nhân viên có lịch nghỉ được duyệt trong tháng {formatMonthDisplay(calendarMonth)}
                  </span>
                </div>
              </div>

              {filteredCalendarLeaves.length === 0 ? (
                <EmptyState
                  icon={Icons.calendar}
                  title={`Không có nhân sự nào nghỉ phép trong tháng ${formatMonthDisplay(calendarMonth)}`}
                  description="Không tìm thấy lịch nghỉ phép nào phù hợp với bộ lọc tìm kiếm hiện tại."
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '16px' }}>
                  {filteredCalendarLeaves.map((item) => (
                    <div
                      key={item.request_id}
                      style={{
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                        backgroundColor: 'var(--surface-card)',
                        boxShadow: 'var(--shadow-card)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px',
                        transition: 'border-color 0.15s ease',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <span className="badge badge-blue">{item.leave_type_name}</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                            {item.total_days} ngày
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                          {item.employee_name} <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>({item.employee_code})</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                          {item.store_name || item.department_name || 'TechZone'}
                        </div>
                        <div style={{ fontSize: '0.8rem', backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', marginBottom: '8px', color: 'var(--text-primary)' }}>
                          <strong style={{ color: 'var(--text-secondary)' }}>Thời gian:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDate(item.start_date)} &rarr; {formatDate(item.end_date)}</span>
                        </div>
                        {item.reason && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            &ldquo;{item.reason}&rdquo;
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ width: '100%', justifyContent: 'center', gap: '6px' }}
                        onClick={() => handleOpenDetailModal(item)}
                      >
                        {Icons.eye} Xem chi tiết đơn
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: TẠO ĐƠN NGHỈ PHÉP MỚI */}
      {/* ========================================================================= */}
      {isCreateModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflowY: 'auto',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
                {isPersonalView ? 'Tạo Đơn Xin Nghỉ Phép Mới' : 'Tạo Đơn Nghỉ Phép Cho Nhân Viên'}
              </h3>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#9ca3af' }}
                onClick={() => setIsCreateModalOpen(false)}
              >
                {Icons.x}
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ padding: '20px' }}>
              {/* Chọn nhân viên khi quản lý/HR/Admin tạo đơn hộ (Searchable Combobox chuẩn Vero Design System) */}
              {!isPersonalView && (
                <div style={{ marginBottom: '16px' }}>
                  <EmployeeSearchSelect
                    employees={employeeList}
                    value={newRequest.employee_id}
                    onChange={(id, emp) => handleSelectEmployee(id, emp)}
                    label="Nhân viên xin nghỉ"
                    placeholder="Tìm theo họ tên, mã NV, chức vụ, chi nhánh..."
                    required
                  />
                  {selectedEmp && (
                    <div style={{ fontSize: '0.8rem', color: '#059669', marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap', backgroundColor: '#f0fdf4', padding: '6px 10px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                      <span>Mã NV: <strong>{selectedEmp.employee_code || `#${selectedEmp.employee_id}`}</strong></span>
                      {selectedEmp.store_name && <span>Chi nhánh: <strong>{selectedEmp.store_name}</strong></span>}
                      {selectedEmp.position_name && <span>Chức vụ: <strong>{selectedEmp.position_name}</strong></span>}
                    </div>
                  )}
                </div>
              )}

              {/* Loại đơn nghỉ phép */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Loại đơn nghỉ phép <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="form-select"
                  value={newRequest.leave_type_id}
                  onChange={(e) => {
                    const newTypeId = Number(e.target.value)
                    const targetType = leaveTypes.find(t => t.leave_type_id === newTypeId)
                    let limit = 180
                    if (targetType?.type_code === 'PHEP_NAM') limit = activeAnnualRemaining
                    else if (targetType?.max_days_allowed && targetType.max_days_allowed > 0) limit = Number(targetType.max_days_allowed)
                    setNewRequest(prev => ({
                      ...prev,
                      leave_type_id: newTypeId,
                      total_days: prev.total_days > limit ? limit : prev.total_days,
                    }))
                  }}
                  required
                >
                  {leaveTypes.map((t) => (
                    <option key={t.leave_type_id} value={t.leave_type_id}>
                      {t.type_name} ({t.is_paid ? 'Có lương' : 'Không lương'}) - Tối đa: {t.max_days_allowed > 0 ? `${t.max_days_allowed} ngày` : 'Theo đơn'}
                    </option>
                  ))}
                </select>
                {selectedTypeInfo && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', marginTop: '4px' }}>
                    {selectedTypeInfo.type_code === 'PHEP_NAM' && (
                      !isPersonalView && !newRequest.employee_id ? (
                        <span style={{ color: '#d97706' }}>
                          Vui lòng chọn nhân viên ở trên để tra cứu số dư phép năm khả dụng.
                        </span>
                      ) : (
                        <span style={{ color: '#2563eb' }}>
                          Số dư phép năm khả dụng: <strong>{activeAnnualRemaining} ngày</strong> (Tổng hạn mức: {activeAnnualTotal} ngày)
                        </span>
                      )
                    )}
                    {selectedTypeInfo.type_code !== 'PHEP_NAM' && selectedTypeInfo.max_days_allowed > 0 && (
                      <span style={{ color: '#4b5563', fontWeight: 500 }}>
                        Quy định: Tối đa <strong>{selectedTypeInfo.max_days_allowed} ngày</strong> cho mỗi đợt nghỉ.
                      </span>
                    )}
                    {selectedTypeInfo.type_code === 'THOI_VIEC' && (
                      <span style={{ color: '#dc2626', fontWeight: 500, display: 'block', marginTop: '2px' }}>
                        Lưu ý: Sau khi HR duyệt đơn thôi việc, tài khoản của bạn sẽ tự động chấm dứt hợp đồng.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Ngày bắt đầu & Ngày kết thúc */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                    Từ ngày <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={newRequest.start_date}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                    Đến ngày <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={newRequest.end_date}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Số ngày nghỉ */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>
                    Tổng số ngày nghỉ <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  {maxAllowedDays > 0 && maxAllowedDays < 180 && (
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: newRequest.total_days > maxAllowedDays ? '#fee2e2' : '#eff6ff',
                      color: newRequest.total_days > maxAllowedDays ? '#dc2626' : '#2563eb',
                      fontWeight: 600,
                    }}>
                      Tối đa: {maxAllowedDays} ngày {selectedTypeInfo?.type_code === 'PHEP_NAM' ? '(theo phép còn lại)' : `(${selectedTypeInfo?.type_name})`}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max={maxAllowedDays}
                  className="form-input"
                  style={newRequest.total_days > maxAllowedDays ? { borderColor: '#ef4444', backgroundColor: '#fff5f5' } : {}}
                  value={newRequest.total_days}
                  onChange={(e) => setNewRequest({ ...newRequest, total_days: parseFloat(e.target.value) || 0.5 })}
                  required
                />
                {newRequest.total_days > maxAllowedDays ? (
                  <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>⚠️</span> Vượt quá giới hạn cho phép! {selectedTypeInfo?.type_name} chỉ được tối đa {maxAllowedDays} ngày.
                  </div>
                ) : (
                  <small style={{ color: 'var(--text-secondary, #6b7280)' }}>Hỗ trợ nghỉ nửa ngày (0.5 ngày) hoặc cả ngày (1, 2, 3... ngày).</small>
                )}
              </div>

              {/* Lý do nghỉ */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Lý do xin nghỉ <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Ghi rõ lý do xin nghỉ để Cửa hàng trưởng và HR thuận tiện xem xét duyệt..."
                  value={newRequest.reason}
                  onChange={(e) => setNewRequest({ ...newRequest, reason: e.target.value })}
                  required
                />
              </div>

              {/* Đính kèm minh chứng & Liên kết ngoài / Drive (Cùng 1 hàng: 85-90% ô link, icon tệp ở bên phải) */}
              <div style={{ marginBottom: '22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.88rem', margin: 0 }}>
                    Minh chứng đính kèm / Link Drive (Tùy chọn)
                  </label>
                  {selectedProofFiles.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 600 }}>
                      Đã chọn {selectedProofFiles.length}/5 tệp
                    </span>
                  )}
                </div>

                {/* Ẩn file input thực tế (cho phép tải tối đa 5 tệp) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  style={{ display: 'none' }}
                  onChange={handleProofFilesSelect}
                />

                {/* Cùng 1 hàng: Ô link chiếm 85-90% + Icon tệp bên phải */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: '1 1 88%', position: 'relative' }}>
                    <input
                      type="url"
                      className="form-input"
                      placeholder="Dán link Google Drive, OneDrive hoặc tài liệu ngoài..."
                      value={manualDriveLink}
                      onChange={(e) => setManualDriveLink(e.target.value)}
                      style={{
                        width: '100%',
                        fontSize: '0.85rem',
                        paddingRight: manualDriveLink ? '32px' : '12px',
                      }}
                    />
                    {manualDriveLink && (
                      <button
                        type="button"
                        onClick={() => setManualDriveLink('')}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#9ca3af',
                          fontSize: '13px',
                          padding: '4px',
                          lineHeight: 1,
                        }}
                        title="Xóa link"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={selectedProofFiles.length >= 5}
                    title={selectedProofFiles.length >= 5 ? 'Đã đạt tối đa 5 tệp đính kèm' : 'Chọn tệp ảnh hoặc PDF từ máy (Tối đa 5 tệp)'}
                    style={{
                      flex: '0 0 auto',
                      width: '42px',
                      height: '38px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      borderRadius: 'var(--radius-md, 6px)',
                      cursor: selectedProofFiles.length >= 5 ? 'not-allowed' : 'pointer',
                      opacity: selectedProofFiles.length >= 5 ? 0.5 : 1,
                    }}
                  >
                    {Icons.paperclip}
                  </button>
                </div>

                {/* Danh sách các tệp preview đã chọn (tối đa 5 tệp, nhấp vào xem được, nút X đen trắng đơn giản) */}
                {selectedProofFiles.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedProofFiles.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          backgroundColor: 'var(--surface-subtle)',
                          border: '1px solid var(--border-default)',
                          borderRadius: '8px',
                          gap: '10px',
                        }}
                      >
                        {/* Nhấp vào tệp preview để mở xem trong tab mới */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            minWidth: 0,
                            cursor: 'pointer',
                            flex: 1,
                          }}
                          onClick={() => window.open(item.previewUrl, '_blank')}
                          title="Nhấp để xem trước tệp trong tab mới"
                        >
                          {item.isImage ? (
                            <img
                              src={item.previewUrl}
                              alt={item.name}
                              style={{
                                width: '36px',
                                height: '36px',
                                objectFit: 'cover',
                                borderRadius: '4px',
                                border: '1px solid var(--border-default)',
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '4px',
                                backgroundColor: '#fee2e2',
                                color: '#dc2626',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '1.2rem',
                                flexShrink: 0,
                                fontWeight: 700,
                              }}
                            >
                              📄
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: '0.84rem',
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.name}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary, #6b7280)', marginTop: '1px' }}>
                              {formatFileSize(item.size)}
                            </div>
                          </div>
                        </div>

                        {/* Nút X đơn giản màu trắng đen */}
                        <button
                          type="button"
                          onClick={() => handleRemoveProofFile(item.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#4b5563',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 700,
                            padding: '4px 8px',
                            borderRadius: '4px',
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#e5e7eb'
                            e.currentTarget.style.color = '#000000'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent'
                            e.currentTarget.style.color = '#4b5563'
                          }}
                          title="Hủy chọn tệp này"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading || (!isPersonalView && !newRequest.employee_id)}
                >
                  {actionLoading ? 'Đang gửi...' : (isPersonalView ? 'Gửi đơn phê duyệt' : 'Tạo đơn cho nhân viên')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: DUYỆT CẤP 1 (CỬA HÀNG TRƯỞNG) */}
      {/* ========================================================================= */}
      {storeApproveModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => !actionLoading && setStoreApproveModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '500px',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Phê Duyệt Đơn Nghỉ Phép</h3>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', color: 'var(--text-primary)' }}>
                <p style={{ margin: '0 0 6px 0' }}><strong>Nhân viên:</strong> {storeApproveModalRequest.employee_name}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Loại nghỉ:</strong> {storeApproveModalRequest.leave_type_name}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Thời gian:</strong> {formatDate(storeApproveModalRequest.start_date)} &rarr; {formatDate(storeApproveModalRequest.end_date)} ({storeApproveModalRequest.total_days} ngày)</p>
                <p style={{ margin: 0 }}><strong>Lý do:</strong> {storeApproveModalRequest.reason}</p>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Ghi chú của Cửa hàng trưởng (sắp xếp nhân sự trực thay)
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={storeManagerNote}
                  onChange={(e) => setStoreManagerNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setStoreApproveModalRequest(null)}
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  disabled={actionLoading}
                  onClick={handleStoreApproveSubmit}
                >
                  {actionLoading ? 'Đang duyệt...' : 'Xác nhận duyệt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: DUYỆT CẤP 2 (PHÒNG NHÂN SỰ) */}
      {/* ========================================================================= */}
      {hrApproveModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => !actionLoading && setHrApproveModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '520px',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Phê Duyệt Đơn Nghỉ Phép (HR)</h3>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', color: 'var(--text-primary)' }}>
                <p style={{ margin: '0 0 6px 0' }}><strong>Nhân viên:</strong> {hrApproveModalRequest.employee_name} ({hrApproveModalRequest.employee_code})</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Chi nhánh:</strong> {hrApproveModalRequest.store_name || 'Trụ sở chính'}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Loại nghỉ:</strong> {hrApproveModalRequest.leave_type_name}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Thời gian:</strong> {formatDate(hrApproveModalRequest.start_date)} &rarr; {formatDate(hrApproveModalRequest.end_date)} ({hrApproveModalRequest.total_days} ngày)</p>
                {hrApproveModalRequest.store_manager_note ? (
                  <p style={{ margin: '0 0 6px 0', color: '#059669' }}>
                    <strong>Ý kiến CHT:</strong> {hrApproveModalRequest.store_manager_note}
                  </p>
                ) : hrApproveModalRequest.status === 'PENDING' ? (
                  <p style={{ margin: '0 0 6px 0', color: '#2563eb', fontSize: '0.85rem' }}>
                    ℹ️ <strong>Duyệt thẳng Cấp 2:</strong> Đơn đang ở trạng thái Chờ duyệt. Phòng Nhân sự có thẩm quyền phê duyệt chính thức trực tiếp mà không cần chờ Cửa hàng trưởng duyệt Cấp 1.
                  </p>
                ) : null}
                <p style={{ margin: 0 }}><strong>Lý do nghỉ:</strong> {hrApproveModalRequest.reason}</p>
              </div>

              {hrApproveModalRequest.leave_type_id === 6 && (
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #f87171', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', color: '#b91c1c', fontSize: '0.85rem' }}>
                  <strong>Cảnh báo nghiệp vụ:</strong> Đây là Đơn xin thôi việc. Khi bấm &ldquo;Phê duyệt chính thức&rdquo;, hệ thống sẽ tự động cập nhật trạng thái nhân sự thành <strong>RESIGNED</strong> và vô hiệu hóa tài khoản đăng nhập để bảo mật.
                </div>
              )}

              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #4b5563)', marginBottom: '20px' }}>
                Sau khi phê duyệt, số ngày phép của nhân viên sẽ tự động được khấu trừ trong số dư phép năm 2026.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setHrApproveModalRequest(null)}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={actionLoading}
                  onClick={handleHrApproveSubmit}
                >
                  {actionLoading ? 'Đang duyệt...' : 'Xác nhận duyệt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: TỪ CHỐI ĐƠN NGHỈ PHÉP */}
      {/* ========================================================================= */}
      {rejectModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => !actionLoading && setRejectModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '480px',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#dc2626', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 900 }}>✕</span>
                {rejectModalRequest.status === 'HR_APPROVED'
                  ? 'Thu Hồi Phê Duyệt & Từ Chối Đơn Nghỉ Phép'
                  : 'Từ Chối Đơn Nghỉ Phép'}
              </h3>
            </div>
            <div style={{ padding: '20px' }}>
              {rejectModalRequest.status === 'HR_APPROVED' && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #f87171',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '16px',
                  fontSize: '0.85rem',
                  color: '#991b1b',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⚠️</span> CẢNH BÁO: ĐƠN ĐÃ ĐƯỢC DUYỆT CHÍNH THỨC
                  </div>
                  <div style={{ lineHeight: 1.5 }}>
                    Khi xác nhận từ chối, hệ thống sẽ:
                    <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                      <li>Chuyển trạng thái đơn thành <strong>Đã từ chối</strong> (ghi nhận rõ người từ chối và lý do).</li>
                      <li>Tự động <strong>hoàn trả {rejectModalRequest.total_days} ngày</strong> vào số dư phép năm của nhân viên.</li>
                      {rejectModalRequest.leave_type_id === 6 && (
                        <li>Khôi phục hồ sơ nhân viên và tài khoản về trạng thái <strong>ACTIVE (Hoạt động)</strong>.</li>
                      )}
                      {rejectModalRequest.leave_type_id === 3 && (
                        <li>Khôi phục trạng thái nhân sự của nhân viên về <strong>ACTIVE</strong>.</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                <p style={{ margin: '0 0 6px 0' }}><strong>Nhân viên:</strong> {rejectModalRequest.employee_name} ({rejectModalRequest.employee_code})</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Loại nghỉ:</strong> {rejectModalRequest.leave_type_name} ({rejectModalRequest.total_days} ngày)</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Thời gian:</strong> {formatDate(rejectModalRequest.start_date)} &rarr; {formatDate(rejectModalRequest.end_date)}</p>
                {rejectModalRequest.hr_approved_at && (
                  <p style={{ margin: 0, color: '#059669', fontSize: '0.8rem' }}>
                    Đã từng được duyệt chính thức bởi: {rejectModalRequest.hr_approver_name || 'Phòng Nhân sự'} ({formatDate(rejectModalRequest.hr_approved_at)})
                  </p>
                )}
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Lý do từ chối đơn <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder={rejectModalRequest.status === 'HR_APPROVED'
                    ? "Ghi rõ lý do thu hồi phê duyệt (ví dụ: Nhân viên xin rút đơn, phát hiện sai lệch số ngày phép...)"
                    : "Ghi rõ lý do không thể duyệt (ví dụ: Thiếu nhân sự trực ca, thời gian trùng đợt cao điểm khuyến mãi...)"}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setRejectModalRequest(null)}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={actionLoading}
                  onClick={handleRejectSubmit}
                  style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <span style={{ fontWeight: 900 }}>✕</span>
                  {actionLoading
                    ? 'Đang xử lý...'
                    : rejectModalRequest.status === 'HR_APPROVED'
                      ? 'Xác nhận Thu hồi & Từ chối'
                      : 'Xác nhận từ chối đơn'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: XEM CHI TIẾT ĐƠN NGHỈ PHÉP */}
      {/* ========================================================================= */}
      {detailModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => setDetailModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
                {detailModalRequest.request_id > 0
                  ? `Chi Tiết Đơn Nghỉ Phép #${detailModalRequest.request_id}`
                  : `Hồ Sơ Nhân Sự Thôi Việc / Chấm Dứt HĐLĐ`}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setPrintModalRequest(detailModalRequest)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  {Icons.printer}
                  <span>In đơn (A4)</span>
                </button>
                <button
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#9ca3af', display: 'flex', alignItems: 'center' }}
                  onClick={() => setDetailModalRequest(null)}
                >
                  {Icons.x}
                </button>
              </div>
            </div>
            <div style={{ padding: '20px' }}>
              {/* KHỐI CẢNH BÁO TỪ CHỐI RÕ RÀNG VỚI DẤU X VÀ CHỮ MÀU ĐỎ NỔI BẬT */}
              {detailModalRequest.status === 'REJECTED' && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  border: '2px solid #f87171',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '20px',
                  boxShadow: '0 2px 4px rgba(220, 38, 38, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#dc2626',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 900,
                      fontSize: '1.1rem',
                      flexShrink: 0
                    }}>
                      ✕
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '1rem', textTransform: 'uppercase', marginBottom: '4px' }}>
                        {detailModalRequest.hr_approved_at
                          ? 'Đơn đã bị Hủy phê duyệt & Từ chối'
                          : 'Đơn xin nghỉ phép đã bị Từ chối'}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#991b1b', marginBottom: '8px' }}>
                        Người từ chối:{' '}
                        <strong style={{ color: '#7f1d1d' }}>{detailModalRequest.rejected_by_name || 'Người có thẩm quyền'}</strong>
                        {detailModalRequest.rejected_by_role && (
                          <span style={{ marginLeft: '4px', backgroundColor: '#fee2e2', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                            {detailModalRequest.rejected_by_role}
                          </span>
                        )}
                        {detailModalRequest.rejected_at && (
                          <span style={{ marginLeft: '8px', color: '#b91c1c' }}>
                            • lúc {formatDate(detailModalRequest.rejected_at)}
                          </span>
                        )}
                      </div>

                      <div style={{
                        backgroundColor: '#fff',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: '1px solid #fca5a5',
                        fontSize: '0.875rem',
                        color: '#7f1d1d',
                        lineHeight: 1.5
                      }}>
                        <strong>Lý do từ chối:</strong> {detailModalRequest.rejection_reason || 'Không có lý do giải trình'}
                      </div>

                      {detailModalRequest.hr_approved_at && (
                        <div style={{
                          fontSize: '0.8rem',
                          color: '#991b1b',
                          marginTop: '8px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '6px',
                          lineHeight: 1.4
                        }}>
                          <span>ℹ️</span>
                          <span>
                            <strong>Lịch sử:</strong> Đơn này đã từng được duyệt chính thức bởi <strong>{detailModalRequest.hr_approver_name || 'Phòng Nhân sự'}</strong> vào lúc {formatDate(detailModalRequest.hr_approved_at)}, nhưng sau đó đã bị thu hồi/từ chối. Hệ thống đã tự động hoàn trả ngày phép và khôi phục trạng thái nhân sự.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Thông tin hồ sơ */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Nhân viên</label>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{detailModalRequest.employee_name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>Mã NV: {detailModalRequest.employee_code || `NV-${detailModalRequest.employee_id}`}</div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Chi nhánh / Phòng ban</label>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{detailModalRequest.store_name || detailModalRequest.department_name || 'TechZone'}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>{detailModalRequest.position_name || 'Nhân viên'}</div>
                </div>
              </div>

              {/* Thông tin nghỉ phép */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Loại đơn</label>
                  <div><span className="badge badge-blue">{detailModalRequest.leave_type_name}</span></div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Trạng thái</label>
                  <div>
                    <span
                      className={`status-pill ${getStatusBadgeClass(detailModalRequest.status)}`}
                      style={detailModalRequest.status === 'REJECTED' ? {
                        backgroundColor: '#fef2f2',
                        color: '#dc2626',
                        borderColor: '#fca5a5',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      } : undefined}
                    >
                      {detailModalRequest.status === 'REJECTED' && <span style={{ fontWeight: 900 }}>✕</span>}
                      {getStatusDisplayLabel(detailModalRequest.status, detailModalRequest)}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {isResignationRecord(detailModalRequest) ? 'Ngày chính thức thôi việc' : 'Thời gian nghỉ'}
                  </label>
                  <div className="table-cell-mono font-bold">
                    {detailModalRequest.start_date === detailModalRequest.end_date || !detailModalRequest.end_date
                      ? formatDate(detailModalRequest.start_date)
                      : `${formatDate(detailModalRequest.start_date)} → ${formatDate(detailModalRequest.end_date)}`}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Tổng số ngày</label>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary-color, #2563eb)' }}>
                    {detailModalRequest.total_days === 0 && isResignationRecord(detailModalRequest)
                      ? 'Chấm dứt HĐLĐ'
                      : `${detailModalRequest.total_days} ngày`}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Lý do xin nghỉ</label>
                <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginTop: '4px', color: 'var(--text-primary)' }}>
                  {detailModalRequest.reason || 'Không có ghi chú'}
                </div>
              </div>

              {detailModalRequest.attachment_url && (() => {
                const { cloudinaryUrls, driveUrl } = parseAttachmentUrls(detailModalRequest.attachment_url)
                if (cloudinaryUrls.length === 0 && !driveUrl) return null

                return (
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                      Tài liệu / Tệp minh chứng đính kèm ({cloudinaryUrls.length + (driveUrl ? 1 : 0)})
                    </label>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* Danh sách tệp minh chứng Cloudinary */}
                      {cloudinaryUrls.map((url, idx) => {
                        const isPdf = /\.pdf($|\?)/i.test(url)
                        const displayUrl = getCloudinaryDisplayUrl(url)
                        return (
                          <div
                            key={idx}
                            style={{
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border-default)',
                              borderRadius: '8px',
                              padding: '10px 14px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {isPdf ? `📄 Tài liệu PDF ${cloudinaryUrls.length > 1 ? `#${idx + 1}` : ''}` : `🖼️ Ảnh minh chứng ${cloudinaryUrls.length > 1 ? `#${idx + 1}` : ''}`}
                              </span>
                              <span style={{ fontSize: '0.72rem', backgroundColor: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', padding: '1px 8px', borderRadius: '12px', fontWeight: 500 }}>
                                ✓ Cloudinary Verified
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              {/* Thumbnail preview có thể bấm để mở tệp nguyên bản */}
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Bấm để mở tệp nguyên bản"
                                style={{
                                  display: 'block',
                                  borderRadius: '6px',
                                  overflow: 'hidden',
                                  border: '1px solid var(--border-default)',
                                  flexShrink: 0,
                                  backgroundColor: '#0000000a',
                                  cursor: 'pointer',
                                  width: '56px',
                                  height: '56px',
                                }}
                              >
                                <img
                                  src={getCloudinaryDisplayUrl(url)}
                                  alt={`Minh chứng #${idx + 1}`}
                                  style={{
                                    width: '56px',
                                    height: '56px',
                                    objectFit: 'cover',
                                    display: 'block',
                                    transition: 'transform 0.2s',
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
                                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                                />
                              </a>

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                  {isPdf ? 'Tài liệu PDF nguyên bản' : 'Ảnh chụp chứng từ'}
                                </div>
                                <div
                                  style={{
                                    fontSize: '0.74rem',
                                    color: 'var(--text-secondary, #6b7280)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={url}
                                >
                                  {url}
                                </div>
                              </div>

                              {/* Biểu tượng kính lúp nằm bên phải lấy từ thư viện icon Icons.search */}
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-secondary btn-icon"
                                title="Mở tệp nguyên bản kích thước đầy đủ"
                                style={{
                                  width: '36px',
                                  height: '36px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: '6px',
                                  color: 'var(--primary-color, #2563eb)',
                                  backgroundColor: '#eff6ff',
                                  border: '1px solid #bfdbfe',
                                  flexShrink: 0,
                                  textDecoration: 'none',
                                }}
                              >
                                {Icons.search}
                              </a>
                            </div>
                          </div>
                        )
                      })}

                      {/* Đường dẫn Google Drive / OneDrive ngoài nếu có */}
                      {driveUrl && (
                        <div style={{
                          backgroundColor: 'var(--surface-subtle)',
                          border: '1px solid var(--border-default)',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '8px', backgroundColor: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                              🔗
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                Đường dẫn Drive / tài liệu ngoài
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={driveUrl}>
                                {driveUrl}
                              </div>
                            </div>
                          </div>
                          <a
                            href={driveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary btn-icon"
                            title="Mở liên kết Drive / tài liệu ngoài"
                            style={{
                              width: '36px',
                              height: '36px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '6px',
                              color: 'var(--primary-color, #2563eb)',
                              backgroundColor: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              flexShrink: 0,
                              textDecoration: 'none',
                            }}
                          >
                            {Icons.search}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}

              {/* Approval Timeline */}
              <div style={{ borderTop: '1px solid var(--border-color, #e5e7eb)', paddingTop: '16px', marginTop: '16px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '12px' }}>
                  Dòng thời gian phê duyệt & Lịch sử xử lý
                </label>

                {/* Bước 1: Gửi đơn */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                    1
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {isResignationRecord(detailModalRequest) ? 'Tiếp nhận hồ sơ nhân sự thôi việc' : 'Nhân viên gửi đơn'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                      {formatDate(detailModalRequest.created_at || detailModalRequest.resignation_date || detailModalRequest.start_date)}
                    </div>
                  </div>
                </div>

                {/* Bước 2: Cửa hàng trưởng duyệt */}
                {(() => {
                  const isResignation = isResignationRecord(detailModalRequest)
                  const isDetailApplicantCht = Boolean(
                    detailModalRequest.is_store_manager_request ||
                    detailModalRequest.position_name === 'Cửa hàng trưởng' ||
                    !detailModalRequest.store_id
                  )
                  const isHrApproved = detailModalRequest.status === 'HR_APPROVED' || Boolean(detailModalRequest.hr_approved_at)

                  // Bước 2 không áp dụng khi:
                  // 1. Hồ sơ thôi việc
                  // 2. Nhân viên nộp là CHT hoặc Khối Trụ sở văn phòng
                  // 3. HR đã duyệt Cấp 2 mà CHT chưa duyệt (Duyệt thẳng)
                  // 4. HR / Admin đã trực tiếp từ chối đơn khi CHT chưa xử lý
                  const isStoreStepNotApplicable = Boolean(
                    isResignation ||
                    isDetailApplicantCht ||
                    (isHrApproved && !detailModalRequest.store_approved_at) ||
                    (detailModalRequest.status === 'REJECTED' && !detailModalRequest.store_approved_at && (detailModalRequest.rejected_by_role === 'Phòng Nhân sự' || detailModalRequest.rejected_by_role === 'Ban Giám đốc / Admin'))
                  )

                  const isStoreRejected = Boolean(
                    !isStoreStepNotApplicable &&
                    detailModalRequest.status === 'REJECTED' &&
                    (detailModalRequest.rejected_by_role === 'Cửa hàng trưởng' ||
                      (!detailModalRequest.store_approved_at && !detailModalRequest.hr_approved_at && detailModalRequest.rejected_by_role !== 'Phòng Nhân sự'))
                  )

                  return (
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: isStoreStepNotApplicable
                          ? '#e5e7eb'
                          : isStoreRejected
                            ? '#dc2626'
                            : detailModalRequest.store_approved_at
                              ? '#10b981'
                              : '#f59e0b',
                        color: isStoreStepNotApplicable ? '#6b7280' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        {isStoreStepNotApplicable ? '—' : isStoreRejected ? '✕' : detailModalRequest.store_approved_at ? '✓' : '2'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isStoreStepNotApplicable ? '#6b7280' : undefined }}>
                          {isStoreRejected ? (
                            <span style={{ color: '#dc2626' }}>Cửa hàng trưởng: Đã từ chối (Cấp 1)</span>
                          ) : (
                            'Cửa hàng trưởng duyệt sơ bộ (Cấp 1)'
                          )}
                        </div>
                        {isStoreStepNotApplicable ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: '#f3f4f6',
                              color: '#6b7280',
                              padding: '1px 8px',
                              borderRadius: '4px',
                              border: '1px solid #d1d5db'
                            }}>
                              Không áp dụng
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                              {isResignation
                                ? '(Hồ sơ thôi việc do Phòng Nhân sự / Ban Giám đốc quản lý trực tiếp)'
                                : isDetailApplicantCht
                                  ? '(Đơn CHT / Khối văn phòng, chuyển thẳng HR duyệt)'
                                  : isHrApproved
                                    ? '(Phòng Nhân sự đã trực tiếp duyệt thẳng Cấp 2, bỏ qua bước CHT)'
                                    : '(Phòng Nhân sự đã trực tiếp xử lý từ chối)'}
                            </span>
                          </div>
                        ) : isStoreRejected ? (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            Người từ chối: {detailModalRequest.rejected_by_name || 'Cửa hàng trưởng'} ({formatDate(detailModalRequest.rejected_at)})
                          </div>
                        ) : detailModalRequest.store_approved_at ? (
                          <>
                            <div style={{ fontSize: '0.8rem', color: '#059669' }}>
                              Người duyệt: {detailModalRequest.store_manager_name || 'Cửa hàng trưởng'} ({formatDate(detailModalRequest.store_approved_at)})
                            </div>
                            {detailModalRequest.store_manager_note && (
                              <div style={{ fontSize: '0.75rem', fontStyle: 'italic', color: '#4b5563' }}>&ldquo;{detailModalRequest.store_manager_note}&rdquo;</div>
                            )}
                          </>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: '#d97706' }}>
                            Đang chờ Cửa hàng trưởng xem xét duyệt (hoặc HR có thể duyệt thẳng)...
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* Bước 3: HR duyệt */}
                {(() => {
                  const isResignation = isResignationRecord(detailModalRequest)
                  const isStoreRejected = Boolean(
                    detailModalRequest.status === 'REJECTED' &&
                    (detailModalRequest.rejected_by_role === 'Cửa hàng trưởng' ||
                      (!detailModalRequest.store_approved_at && !detailModalRequest.hr_approved_at && detailModalRequest.rejected_by_role !== 'Phòng Nhân sự'))
                  )
                  // Bước HR duyệt Cấp 2 không áp dụng khi đơn đã bị CHT từ chối ngay tại Cấp 1
                  const isHrStepNotApplicable = isStoreRejected

                  const wasHrApprovedBeforeReject = detailModalRequest.status === 'REJECTED' && Boolean(detailModalRequest.hr_approved_at)
                  const isHrRejected = !isHrStepNotApplicable && detailModalRequest.status === 'REJECTED' && (detailModalRequest.rejected_by_role === 'Phòng Nhân sự' || detailModalRequest.rejected_by_role === 'Ban Giám đốc / Admin')
                  const isHrApproved = detailModalRequest.status === 'HR_APPROVED' || Boolean(detailModalRequest.hr_approved_at)

                  return (
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: isHrStepNotApplicable
                          ? '#e5e7eb'
                          : wasHrApprovedBeforeReject || isHrRejected
                            ? '#dc2626'
                            : isHrApproved
                              ? '#10b981'
                              : '#3b82f6',
                        color: isHrStepNotApplicable ? '#6b7280' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        {isHrStepNotApplicable ? '—' : (wasHrApprovedBeforeReject || isHrRejected) ? '✕' : isHrApproved ? '✓' : '3'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isHrStepNotApplicable ? '#6b7280' : undefined }}>
                          {wasHrApprovedBeforeReject ? (
                            <span style={{ color: '#dc2626' }}>Phòng Nhân sự: Đã Hủy Phê Duyệt & Từ Chối</span>
                          ) : isHrRejected ? (
                            <span style={{ color: '#dc2626' }}>Phòng Nhân sự: Đã từ chối (Cấp 2)</span>
                          ) : isResignation ? (
                            'Phòng Nhân sự phê duyệt quyết định thôi việc'
                          ) : (
                            'Phòng Nhân sự phê duyệt chính thức (Cấp 2)'
                          )}
                        </div>
                        {isHrStepNotApplicable ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: '#f3f4f6',
                              color: '#6b7280',
                              padding: '1px 8px',
                              borderRadius: '4px',
                              border: '1px solid #d1d5db'
                            }}>
                              Không áp dụng
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                              (Đơn đã dừng do Cửa hàng trưởng từ chối ở Cấp 1)
                            </span>
                          </div>
                        ) : wasHrApprovedBeforeReject ? (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            <div>Người hủy & từ chối: {detailModalRequest.rejected_by_name || 'Phòng Nhân sự'} ({formatDate(detailModalRequest.rejected_at)})</div>
                            <div style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.75rem', textDecoration: 'line-through' }}>
                              Từng được duyệt bởi: {detailModalRequest.hr_approver_name || 'Phòng Nhân sự'} ({formatDate(detailModalRequest.hr_approved_at)})
                            </div>
                          </div>
                        ) : isHrRejected ? (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            Người từ chối: {detailModalRequest.rejected_by_name || 'Phòng Nhân sự'} ({formatDate(detailModalRequest.rejected_at)})
                          </div>
                        ) : isHrApproved ? (
                          <div style={{ fontSize: '0.8rem', color: '#059669' }}>
                            Người duyệt: {detailModalRequest.hr_approver_name || 'Trưởng phòng Nhân sự'}
                            {detailModalRequest.hr_approved_at ? ` (${formatDate(detailModalRequest.hr_approved_at)})` : ''}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: '#2563eb' }}>
                            {detailModalRequest.status === 'STORE_APPROVED'
                              ? 'Đang chờ Phòng Nhân sự phê duyệt chính thức...'
                              : 'Chờ CHT duyệt Cấp 1 (hoặc HR có thể duyệt thẳng bất cứ lúc nào)...'}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setPrintModalRequest(detailModalRequest)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                  >
                    {Icons.printer}
                    <span>In đơn nghỉ phép (A4)</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDetailModalRequest(null)}
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DANH SÁCH TẤT CẢ NHÂN SỰ NGHỈ TRONG NGÀY */}
      {/* ========================================================================= */}
      {selectedDayLeavesModal && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedDayLeavesModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-lg, 0 20px 25px -5px rgba(0,0,0,0.2))',
              borderRadius: 'var(--radius-lg, 12px)',
              overflow: 'hidden',
              animation: 'modalSlideIn 0.2s ease',
            }}
          >
            {/* Modal Header */}
            <div
              className="card-header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-default)',
                backgroundColor: 'var(--surface-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    color: 'var(--action-primary)',
                  }}
                >
                  {Icons.calendar}
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Nhân Sự Nghỉ Phép Ngày {formatDate(selectedDayLeavesModal.dateStr)}
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Tổng cộng {selectedDayLeavesModal.leaves.length} nhân sự vắng mặt theo lịch đã duyệt
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedDayLeavesModal(null)}
                style={{ padding: '6px', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {Icons.close}
              </button>
            </div>

            {/* Modal Body */}
            <div
              className="card-body"
              style={{
                padding: '16px 20px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxHeight: 'calc(90vh - 140px)',
              }}
            >
              {selectedDayLeavesModal.leaves.map((lv) => (
                <div
                  key={'day-modal-lv-' + lv.request_id}
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px',
                    backgroundColor: 'var(--surface-card)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '240px', flex: 1 }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-default)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: 'var(--action-primary)',
                        flexShrink: 0,
                      }}
                    >
                      {lv.employee_name?.split(' ').slice(-1)[0]?.charAt(0) || 'NV'}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                          {lv.employee_name}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          ({lv.employee_code})
                        </span>
                        <span className="badge badge-blue" style={{ fontSize: '10.5px' }}>
                          {lv.leave_type_name}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {lv.store_name || lv.department_name || 'TechZone'} {lv.position_name ? `• ${lv.position_name}` : ''}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Thời gian nghỉ: <strong style={{ color: 'var(--text-primary)' }}>{formatDate(lv.start_date)}</strong> &rarr; <strong style={{ color: 'var(--text-primary)' }}>{formatDate(lv.end_date)}</strong> ({lv.total_days} ngày)
                      </div>
                      {lv.reason && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '4px' }}>
                          &ldquo;{lv.reason}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ gap: '6px', fontSize: '12px' }}
                      onClick={() => {
                        setSelectedDayLeavesModal(null)
                        handleOpenDetailModal(lv)
                      }}
                    >
                      {Icons.eye} Chi tiết đơn
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div
              className="card-footer"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '12px 20px',
                borderTop: '1px solid var(--border-default)',
                backgroundColor: 'var(--surface-subtle)',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedDayLeavesModal(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PRINTABLE LEAVE REQUEST POPUP OVERLAY (PDF / A4)                   */}
      {/* ========================================================================= */}
      {printModalRequest && (() => {
        const isRejected = printModalRequest.status === 'REJECTED'
        const wasHrApprovedBeforeReject = isRejected && Boolean(printModalRequest.hr_approved_at)
        const isHrApproved = printModalRequest.status === 'HR_APPROVED'
        const isStoreApproved = Boolean(printModalRequest.store_approved_at)
        const isResignation = isResignationRecord(printModalRequest)

        const reqDate = new Date(printModalRequest.created_at || printModalRequest.start_date)
        const dayStr = String(isNaN(reqDate.getDate()) ? new Date().getDate() : reqDate.getDate()).padStart(2, '0')
        const monthStr = String(isNaN(reqDate.getMonth()) ? new Date().getMonth() + 1 : reqDate.getMonth() + 1).padStart(2, '0')
        const yearStr = isNaN(reqDate.getFullYear()) ? new Date().getFullYear() : reqDate.getFullYear()

        return (
          <div className="modal-overlay print-active-overlay" onClick={() => setPrintModalRequest(null)}>
            <div className="modal print-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '860px', padding: '0', maxHeight: '94vh' }}>
              {/* Modal Header (Hidden on print) */}
              <div className="modal-header no-print">
                <h2 className="modal-title" style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#2563eb' }}>{Icons.printer}</span>
                  <span>Bản In Đơn Nghỉ Phép (Khổ A4 Chuẩn Thể Thức Hành Chính)</span>
                </h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
                    {Icons.printer}
                    <span>In đơn (A4)</span>
                  </button>
                  <button
                    className="modal-close"
                    onClick={() => setPrintModalRequest(null)}
                    title="Đóng"
                  >
                    {Icons.close || Icons.x}
                  </button>
                </div>
              </div>

              {/* A4 Sheet Body */}
              <div className="payslip-modal-body" style={{ overflowY: 'auto', padding: '20px 16px', background: 'var(--surface-ground, #f1f5f9)' }}>
                <div className="leave-a4-container">
                  {/* 1. Header 2 Cột: Đơn vị chủ quản & Quốc hiệu chuẩn Thể thức Hành chính */}
                  <div className="leave-a4-national-header">
                    <div className="leave-hdr-org">
                      <div className="leave-org-name">CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE VIỆT NAM</div>
                      <div className="leave-org-sub">HỆ THỐNG PHÂN PHỐI & CHUỖI BÁN LẺ TOÀN QUỐC</div>
                      {printModalRequest.store_name && (
                        <div style={{ fontSize: '10.5px', color: '#1e3a8a', fontWeight: 600, marginTop: '1px' }}>
                          Đơn vị: {printModalRequest.store_name}
                        </div>
                      )}
                      <div className="leave-doc-number">
                        Số: <strong>#LR-{printModalRequest.request_id}</strong>/ĐXNP-TZ
                      </div>
                    </div>

                    <div className="leave-hdr-motto">
                      <div className="leave-motto-country">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                      <div className="leave-motto-subtitle">Độc lập – Tự do – Hạnh phúc</div>
                      <div className="leave-motto-line"></div>
                      <div className="leave-doc-date">
                        TP. Hồ Chí Minh, ngày {dayStr} tháng {monthStr} năm {yearStr}
                      </div>
                    </div>
                  </div>

                  {/* 2. Tiêu đề đơn */}
                  <div className="leave-a4-title-section">
                    <div className="leave-doc-main-title">
                      {isResignation ? 'ĐƠN XIN THÔI VIỆC' : 'ĐƠN XIN NGHỈ PHÉP'}
                    </div>
                    <div className="leave-doc-legal-basis">
                      (Căn cứ Bộ luật Lao động số 45/2019/QH14 và Nội quy lao động Công ty TechZone)
                    </div>
                  </div>

                  {/* 3. Kính gửi */}
                  <div className="leave-kinh-gui-box">
                    <div>
                      <span className="leave-kinh-gui-title">Kính gửi:</span>
                      <span>- Ban Giám đốc Công ty Cổ phần Công nghệ TechZone Việt Nam;</span>
                    </div>
                    <div style={{ paddingLeft: '55px' }}>
                      <span>- Phòng Quản lý Nhân sự;</span>
                    </div>
                    <div style={{ paddingLeft: '55px' }}>
                      <span>- Quản lý trực tiếp / Cửa hàng trưởng phụ trách đơn vị.</span>
                    </div>
                  </div>

                  {/* Cảnh báo rõ ràng đối với đơn đã từng duyệt nhưng sau đó bị hủy duyệt / thu hồi */}
                  {wasHrApprovedBeforeReject && (
                    <div
                      style={{
                        backgroundColor: '#fef2f2',
                        border: '1.5px solid #f87171',
                        borderRadius: '4px',
                        padding: '6px 10px',
                        marginBottom: '8px',
                        fontSize: '11px',
                        lineHeight: 1.35,
                      }}
                    >
                      <div style={{ fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: '2px', fontSize: '11px' }}>
                        ✕ LƯU Ý: ĐƠN NÀY ĐÃ BỊ HỦY PHÊ DUYỆT & TỪ CHỐI
                      </div>
                      <div style={{ color: '#991b1b' }}>
                        Đơn từng được phê duyệt ngày <strong>{formatDate(printModalRequest.hr_approved_at)}</strong>, sau đó đã bị hủy duyệt bởi{' '}
                        <strong>{printModalRequest.rejected_by_name || 'Phòng Nhân sự'}</strong>
                        {printModalRequest.rejected_at ? ` ngày ${formatDate(printModalRequest.rejected_at)}` : ''}.
                        {printModalRequest.rejection_reason && ` (Lý do: ${printModalRequest.rejection_reason})`}
                      </div>
                    </div>
                  )}

                  {/* 4. Phần I: Thông tin người làm đơn */}
                  <div className="leave-sec-title">I. THÔNG TIN NGƯỜI LÀM ĐƠN</div>
                  <div className="leave-info-grid">
                    <div>Họ và tên nhân sự: <strong style={{ textTransform: 'uppercase' }}>{printModalRequest.employee_name || ''}</strong></div>
                    <div>Mã số nhân viên: <strong>{printModalRequest.employee_code || (`NV-${printModalRequest.employee_id}`)}</strong></div>
                    <div>Chức danh / Vị trí: <strong>{printModalRequest.position_name || 'Nhân viên'}</strong></div>
                    <div>Đơn vị công tác: <strong>{printModalRequest.store_name || printModalRequest.department_name || 'Khối Văn phòng'}</strong></div>
                  </div>

                  {/* 5. Phần II: Chi tiết nghỉ phép & bàn giao */}
                  <div className="leave-sec-title">II. NỘI DUNG ĐỀ NGHỊ {isResignation ? 'THÔI VIỆC' : 'NGHỈ PHÉP'} & BÀN GIAO</div>
                  <table className="leave-admin-table">
                    <tbody>
                      <tr>
                        <td style={{ width: '28%', fontWeight: 700, background: '#f8fafc' }}>Hình thức / Loại nghỉ:</td>
                        <td style={{ width: '72%' }}>
                          <strong style={{ color: '#1e3a8a' }}>{printModalRequest.leave_type_name || 'Nghỉ phép'}</strong>
                          <span style={{ color: '#64748b', fontSize: '10.5px', marginLeft: '8px' }}>
                            ({printModalRequest.leave_type_code === 'NGHI_KHONG_LUONG' ? 'Nghỉ không hưởng lương' : 'Nghỉ hưởng nguyên lương theo chế độ'})
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: '#f8fafc' }}>
                          {isResignation ? 'Ngày chính thức thôi việc:' : 'Thời gian đề xuất nghỉ:'}
                        </td>
                        <td>
                          {printModalRequest.start_date === printModalRequest.end_date || !printModalRequest.end_date ? (
                            <span>Ngày <strong>{formatDate(printModalRequest.start_date)}</strong></span>
                          ) : (
                            <span>
                              Từ ngày <strong>{formatDate(printModalRequest.start_date)}</strong> đến hết ngày <strong>{formatDate(printModalRequest.end_date)}</strong>
                            </span>
                          )}
                          <strong style={{ color: '#2563eb', marginLeft: '12px' }}>({printModalRequest.total_days} ngày)</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: '#f8fafc' }}>Lý do xin nghỉ:</td>
                        <td>{printModalRequest.reason || 'Lý do giải quyết việc cá nhân'}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: '#f8fafc' }}>Bàn giao & Chứng từ:</td>
                        <td style={{ color: '#334155' }}>
                          Đã hoàn tất bàn giao ca kíp làm việc, tài sản và nhiệm vụ chuyên môn trước khi nghỉ.
                          {printModalRequest.attachment_url && (
                            <span style={{ color: '#059669', fontWeight: 600, marginLeft: '6px' }}>
                              (✓ Đã đính kèm hồ sơ minh chứng hợp lệ trên hệ thống)
                            </span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* 6. Phần III: Cam kết của người làm đơn */}
                  <div className="leave-sec-title">III. CAM KẾT CỦA NGƯỜI LÀM ĐƠN</div>
                  <p className="leave-commit-text" style={{ margin: '0 0 6px', fontSize: '11px', lineHeight: 1.35, textIndent: '20px' }}>
                    Tôi cam kết toàn bộ thông tin trình bày là chính xác, chấp hành nghiêm túc trách nhiệm bàn giao và có mặt làm việc trở lại đúng thời gian. Nếu vi phạm, tôi xin hoàn toàn chịu trách nhiệm theo Nội quy lao động của TechZone. Kính mong Ban Giám đốc và Quản lý cấp trên xem xét, tạo điều kiện phê duyệt. Tôi xin chân thành cảm ơn!
                  </p>

                  {/* 7. Phần IV: Ý kiến phê duyệt của cấp có thẩm quyền (Đồng nhất mẫu form khi chưa duyệt và đã duyệt) */}
                  <div className="leave-sec-title">IV. Ý KIẾN PHÊ DUYỆT CỦA CẤP CÓ THẨM QUYỀN</div>
                  <table className="leave-admin-table" style={{ marginBottom: '14px' }}>
                    <tbody>
                      {/* Cấp 1: CHT / Quản lý trực tiếp */}
                      <tr>
                        <td style={{ width: '28%', fontWeight: 700, background: '#f8fafc', verticalAlign: 'top', paddingTop: '8px' }}>
                          1. Quản lý trực tiếp / CHT:
                        </td>
                        <td style={{ width: '72%', padding: '8px 10px' }}>
                          <div>
                            {/* Dòng tick chọn: Đồng ý / Không đồng ý */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <div style={{ display: 'flex', gap: '32px', alignItems: 'center', fontSize: '11.5px' }}>
                                <span>
                                  <strong style={{ fontSize: '12px' }}>[{isStoreApproved ? ' ✓ ' : '\u00A0\u00A0\u00A0'}]</strong> Đồng ý
                                </span>
                                <span>
                                  <strong style={{ fontSize: '12px' }}>[{(!isStoreApproved && isRejected && !wasHrApprovedBeforeReject) ? ' ✓ ' : '\u00A0\u00A0\u00A0'}]</strong> Không đồng ý
                                </span>
                              </div>
                              {isStoreApproved && printModalRequest.store_approved_at && (
                                <div style={{ fontSize: '10.5px', color: '#64748b', fontStyle: 'italic' }}>
                                  Ngày: {formatDate(printModalRequest.store_approved_at)}
                                </div>
                              )}
                            </div>

                            {/* Xuống hàng: 2-3 dòng chấm chừa chỗ điền ý kiến */}
                            <div style={{ fontSize: '11px', color: '#1f2937' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-end', minHeight: '19px' }}>
                                <span style={{ whiteSpace: 'nowrap', marginRight: '6px' }}>Ý kiến:</span>
                                <span style={{ flex: 1, borderBottom: '1px dotted #94a3b8', paddingBottom: '1px' }}>
                                  {isStoreApproved ? (printModalRequest.store_manager_note || 'Đồng ý phê duyệt, đã sắp xếp nhân sự trực thay thế.') : ''}
                                </span>
                              </div>
                              <div style={{ borderBottom: '1px dotted #94a3b8', height: '19px' }}></div>
                              <div style={{ borderBottom: '1px dotted #94a3b8', height: '19px' }}></div>
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Cấp 2: Phòng Nhân sự / Ban Giám đốc */}
                      <tr>
                        <td style={{ fontWeight: 700, background: '#f8fafc', verticalAlign: 'top', paddingTop: '8px' }}>
                          2. Phòng Nhân sự / BGĐ:
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div>
                            {/* Dòng tick chọn: Đồng ý / Không đồng ý */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <div style={{ display: 'flex', gap: '32px', alignItems: 'center', fontSize: '11.5px' }}>
                                <span>
                                  <strong style={{ fontSize: '12px' }}>[{isHrApproved ? ' ✓ ' : '\u00A0\u00A0\u00A0'}]</strong> Đồng ý
                                </span>
                                <span>
                                  <strong style={{ fontSize: '12px' }}>[{(isRejected || wasHrApprovedBeforeReject) ? ' ✓ ' : '\u00A0\u00A0\u00A0'}]</strong> Không đồng ý
                                </span>
                              </div>
                              {((isHrApproved && printModalRequest.hr_approved_at) || ((isRejected || wasHrApprovedBeforeReject) && printModalRequest.rejected_at)) && (
                                <div style={{ fontSize: '10.5px', color: '#64748b', fontStyle: 'italic' }}>
                                  Ngày: {formatDate(isHrApproved ? printModalRequest.hr_approved_at : printModalRequest.rejected_at)}
                                </div>
                              )}
                            </div>

                            {/* Xuống hàng: 2-3 dòng chấm chừa chỗ điền ý kiến */}
                            <div style={{ fontSize: '11px', color: '#1f2937' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-end', minHeight: '19px' }}>
                                <span style={{ whiteSpace: 'nowrap', marginRight: '6px' }}>Ý kiến:</span>
                                <span style={{ flex: 1, borderBottom: '1px dotted #94a3b8', paddingBottom: '1px' }}>
                                  {wasHrApprovedBeforeReject
                                    ? `Đã hủy duyệt: ${printModalRequest.rejection_reason || 'Thu hồi phê duyệt'}`
                                    : isRejected
                                      ? `Không chấp thuận: ${printModalRequest.rejection_reason || 'Từ chối đơn'}`
                                      : isHrApproved
                                        ? 'Đã đối soát ngày công và phép năm. Chấp thuận giải quyết chế độ nghỉ theo quy định.'
                                        : ''}
                                </span>
                              </div>
                              <div style={{ borderBottom: '1px dotted #94a3b8', height: '19px' }}></div>
                              <div style={{ borderBottom: '1px dotted #94a3b8', height: '19px' }}></div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* 8. Phần V: Chữ ký xác nhận các bên (Tách riêng biệt, khoảng trắng để ký tay & đóng dấu) */}
                  <div className="leave-sec-title">V. CHỮ KÝ XÁC NHẬN CÁC BÊN</div>
                  <div className="leave-3col-signatures" style={{ marginTop: '10px' }}>
                    {/* Cột 1: Người làm đơn */}
                    <div>
                      <div className="leave-sign-col-title">NGƯỜI LÀM ĐƠN</div>
                      <div className="leave-sign-col-sub">(Ký, ghi rõ họ tên)</div>
                      <div className="leave-sign-space" style={{ height: '60px' }}></div>
                      <div className="leave-sign-name" style={{ textTransform: 'uppercase' }}>
                        {printModalRequest.employee_name || ''}
                      </div>
                    </div>

                    {/* Cột 2: Cửa hàng trưởng / QLTT */}
                    <div>
                      <div className="leave-sign-col-title">CỬA HÀNG TRƯỞNG / QLTT</div>
                      <div className="leave-sign-col-sub">(Ký, ghi rõ họ tên)</div>
                      <div className="leave-sign-space" style={{ height: '60px' }}></div>
                      <div className="leave-sign-name">
                        {isStoreApproved ? (printModalRequest.store_manager_name || 'Cửa hàng trưởng') : ''}
                      </div>
                    </div>

                    {/* Cột 3: Phòng Nhân sự / Ban Giám đốc */}
                    <div>
                      <div className="leave-sign-col-title">PHÒNG NHÂN SỰ / BAN GIÁM ĐỐC</div>
                      <div className="leave-sign-col-sub">(Ký tên, đóng dấu)</div>
                      <div className="leave-sign-space" style={{ height: '60px' }}></div>
                      <div className="leave-sign-name">
                        {isHrApproved ? (printModalRequest.hr_approver_name || 'Trưởng phòng Nhân sự') : ''}
                      </div>
                    </div>
                  </div>

                  {/* Dòng phân cách chân trang */}
                  <div style={{ marginTop: '14px', paddingTop: '6px', borderTop: '1px solid #cbd5e1', fontSize: '10px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                    <div>TechZone HRM • Hệ thống Quản trị Doanh nghiệp chuẩn Thể thức Hành chính Việt Nam</div>
                    <div>Số: #LR-{printModalRequest.request_id} • In ngày: {new Date().toLocaleDateString('vi-VN')}</div>
                  </div>
                </div>
              </div>

              {/* Modal Footer (Hidden on print) */}
              <div className="modal-footer no-print" style={{ padding: '12px 20px', background: 'var(--surface-card)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button className="btn btn-secondary" onClick={() => setPrintModalRequest(null)}>
                  Đóng
                </button>
                <button className="btn btn-primary" onClick={() => window.print()}>
                  {Icons.printer}
                  <span>In đơn (A4)</span>
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
