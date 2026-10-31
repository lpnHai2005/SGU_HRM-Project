import React, { useState, useEffect } from 'react'
import { Icons } from '../components/common/Icons'
import { payrollApi } from '../services/api'
import type { PayrollPolicySetting, PayrollPeriodBonus, PublicHoliday, PayrollPeriodWorkingDays } from '../types'
import { formatCurrency } from '../utils/formatters'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import './PayrollRegulationDialog.css'

// Mẫu khoản thưởng kỳ phổ biến để điền nhanh
const BONUS_PRESETS = [
  {
    code: 'TET_BONUS',
    name: 'Thưởng Tết Nguyên Đán',
    defaultType: 'COEFFICIENT',
    suggestedAmount: 5000000,
    month: '02',
  },
  {
    code: 'HOLIDAY_BONUS_30_4',
    name: 'Thưởng Lễ Chiến Thắng 30/4 & Quốc Tế Lao Động 1/5',
    defaultType: 'COEFFICIENT',
    suggestedAmount: 1000000,
    month: '04',
  },
  {
    code: 'HOLIDAY_BONUS_2_9',
    name: 'Thưởng Lễ Quốc Khánh 2/9',
    defaultType: 'COEFFICIENT',
    suggestedAmount: 1000000,
    month: '09',
  },
  {
    code: 'YEAR_END_BONUS',
    name: 'Thưởng Tổng Kết Cuối Năm (Tháng 13)',
    defaultType: 'CONTRACT_SALARY',
    suggestedAmount: 0,
    month: '12',
  },
]

const VIETNAMESE_DAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

export interface PayrollRegulationDialogProps {
  onClose: () => void
  initialTab?: 'settings' | 'bonuses' | 'holidays_working_days' | 'attendance' | 'guide'
}

export function PayrollRegulationDialog({ onClose, initialTab }: PayrollRegulationDialogProps) {
  const { user } = useAuth()
  const isHrOrAdmin = Boolean(user?.roles?.some((r: string) => ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(r)))

  // Nếu là nhân viên không có quyền quản lý, chỉ mở tab 'guide' hoặc 'attendance'
  const [activeTab, setActiveTab] = useState<'settings' | 'bonuses' | 'holidays_working_days' | 'attendance' | 'guide'>(() => {
    if (initialTab) return initialTab
    return isHrOrAdmin ? 'settings' : 'guide'
  })

  // State Tham số Quy chế
  const [settings, setSettings] = useState<PayrollPolicySetting[]>([])
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<number>(0)
  const [editDesc, setEditDesc] = useState<string>('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [settingSearch, setSettingSearch] = useState<string>('')
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL')

  // State Thưởng Kỳ (Tết, Lễ...)
  const [bonuses, setBonuses] = useState<PayrollPeriodBonus[]>([])
  const [loadingBonuses, setLoadingBonuses] = useState(false)
  const [bonusSearch, setBonusSearch] = useState<string>('')
  const [showBonusModal, setShowBonusModal] = useState(false)
  const [editingBonus, setEditingBonus] = useState<PayrollPeriodBonus | null>(null)

  // Fields trong Modal Thiết Lập Thưởng Kỳ
  const [bonusPeriod, setBonusPeriod] = useState<string>('')
  const [bonusCode, setBonusCode] = useState<string>('')
  const [bonusName, setBonusName] = useState<string>('')
  const [bonusType, setBonusType] = useState<string>('COEFFICIENT')
  const [bonusAmount, setBonusAmount] = useState<number>(0)
  const [bonusRecurring, setBonusRecurring] = useState<boolean>(false)
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [savingBonus, setSavingBonus] = useState(false)

  // State Lịch Lễ, Tết & Công chuẩn (Tab 3)
  const [selectedWorkingPeriod, setSelectedWorkingPeriod] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [workingDaysData, setWorkingDaysData] = useState<PayrollPeriodWorkingDays | null>(null)
  const [loadingWorkingDays, setLoadingWorkingDays] = useState(false)
  const [isManualOverride, setIsManualOverride] = useState(false)
  const [manualDays, setManualDays] = useState<number>(26)
  const [manualReason, setManualReason] = useState<string>('')
  const [savingWorkingDays, setSavingWorkingDays] = useState(false)

  // State Danh mục Ngày lễ
  const [holidayYear, setHolidayYear] = useState<number>(() => new Date().getFullYear())
  const [holidays, setHolidays] = useState<PublicHoliday[]>([])
  const [loadingHolidays, setLoadingHolidays] = useState(false)
  const [showHolidayModal, setShowHolidayModal] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState<PublicHoliday | null>(null)
  const [holidayDate, setHolidayDate] = useState<string>('')
  const [holidayName, setHolidayName] = useState<string>('')
  const [holidayNotes, setHolidayNotes] = useState<string>('')
  const [savingHoliday, setSavingHoliday] = useState(false)

  // Tải danh sách cấu hình tham số (chỉ dành cho HR/Admin)
  const fetchSettings = async () => {
    if (!isHrOrAdmin) return
    setLoadingSettings(true)
    try {
      const data = await payrollApi.getPolicySettings()
      setSettings(data || [])
    } catch (err: any) {
      console.error('Error fetching policy settings:', err)
      toast.error('Lỗi khi tải tham số quy chế lương')
    } finally {
      setLoadingSettings(false)
    }
  }

  // Tải danh sách thưởng kỳ (chỉ dành cho HR/Admin)
  const fetchBonuses = async () => {
    if (!isHrOrAdmin) return
    setLoadingBonuses(true)
    try {
      const data = await payrollApi.getPeriodBonuses()
      setBonuses(data || [])
    } catch (err: any) {
      console.error('Error fetching period bonuses:', err)
      toast.error('Lỗi khi tải danh mục thưởng kỳ')
    } finally {
      setLoadingBonuses(false)
    }
  }

  // Tải thông số công chuẩn của kỳ lương
  const fetchWorkingDays = async (period: string) => {
    setLoadingWorkingDays(true)
    try {
      const data = await payrollApi.getWorkingDays(period)
      setWorkingDaysData(data)
      setIsManualOverride(Boolean(data.is_manual_override))
      setManualDays(data.manual_standard_days ?? data.auto_standard_days ?? 26)
      setManualReason(data.reason || '')
    } catch (err: any) {
      console.error('Error fetching working days:', err)
      toast.error(err.message || 'Lỗi khi tải thông số ngày công chuẩn')
    } finally {
      setLoadingWorkingDays(false)
    }
  }

  // Tải danh mục ngày lễ theo năm
  const fetchHolidays = async (year: number) => {
    setLoadingHolidays(true)
    try {
      const data = await payrollApi.getHolidays(year)
      setHolidays(data || [])
    } catch (err: any) {
      console.error('Error fetching holidays:', err)
      toast.error(err.message || 'Lỗi khi tải danh mục ngày lễ')
    } finally {
      setLoadingHolidays(false)
    }
  }

  useEffect(() => {
    if (!isHrOrAdmin) {
      if (activeTab !== 'guide' && activeTab !== 'attendance') {
        setActiveTab('guide')
      }
      return
    }
    if (activeTab === 'settings') {
      fetchSettings()
    } else if (activeTab === 'bonuses') {
      fetchBonuses()
    } else if (activeTab === 'holidays_working_days') {
      fetchWorkingDays(selectedWorkingPeriod)
      fetchHolidays(holidayYear)
    }
  }, [activeTab, isHrOrAdmin, selectedWorkingPeriod, holidayYear])

  // Xử lý lưu tham số quy chế
  const handleSaveSetting = async (key: string) => {
    setSavingKey(key)
    try {
      await payrollApi.updatePolicySetting(key, {
        numeric_value: editValue,
        description: editDesc || undefined,
      })
      toast.success(`Đã cập nhật tham số ${key}!`)
      setEditingKey(null)
      await fetchSettings()
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi cập nhật tham số')
    } finally {
      setSavingKey(null)
    }
  }

  // Mở modal tạo mới thưởng kỳ
  const handleOpenCreateBonus = () => {
    setEditingBonus(null)
    setBonusPeriod('')
    setBonusCode('')
    setBonusName('')
    setBonusType('COEFFICIENT')
    setBonusAmount(0)
    setBonusRecurring(false)
    setSelectedPreset('')
    setShowBonusModal(true)
  }

  // Mở modal chỉnh sửa thưởng kỳ
  const handleOpenEditBonus = (bonus: PayrollPeriodBonus) => {
    setEditingBonus(bonus)
    setBonusPeriod(bonus.salary_period)
    setBonusCode(bonus.bonus_code)
    setBonusName(bonus.bonus_name)
    setBonusType(bonus.calculation_type || 'COEFFICIENT')
    setBonusAmount(Number(bonus.base_amount) || 0)
    setBonusRecurring(Boolean(bonus.is_recurring))
    setSelectedPreset('')
    setShowBonusModal(true)
  }

  // Chọn mẫu gợi ý thưởng
  const handleSelectPreset = (presetCode: string) => {
    setSelectedPreset(presetCode)
    if (!presetCode) return

    if (presetCode === 'CUSTOM') {
      setBonusCode('')
      setBonusName('')
      return
    }

    const preset = BONUS_PRESETS.find(p => p.code === presetCode)
    if (preset) {
      setBonusCode(preset.code)
      setBonusName(preset.name)
      setBonusType(preset.defaultType)
      if (preset.suggestedAmount > 0 && bonusAmount === 0) {
        setBonusAmount(preset.suggestedAmount)
      }
      if (!bonusPeriod) {
        const currentYear = new Date().getFullYear()
        setBonusPeriod(`${currentYear}-${preset.month}`)
      }
    }
  }

  // Submit form tạo/sửa thưởng kỳ
  const handleSubmitBonus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bonusPeriod) {
      toast.error('Vui lòng chọn kỳ lương (YYYY-MM)')
      return
    }
    if (!bonusCode.trim()) {
      toast.error('Vui lòng nhập mã khoản thưởng')
      return
    }
    if (!bonusName.trim()) {
      toast.error('Vui lòng nhập tên khoản thưởng')
      return
    }

    setSavingBonus(true)
    try {
      if (editingBonus) {
        await payrollApi.updatePeriodBonus(editingBonus.bonus_id, {
          bonus_name: bonusName.trim(),
          calculation_type: bonusType,
          base_amount: Number(bonusAmount) || 0,
          is_recurring: bonusRecurring,
        })
        toast.success(`Đã cập nhật khoản thưởng '${bonusName}'!`)
      } else {
        await payrollApi.createPeriodBonus({
          salary_period: bonusPeriod,
          bonus_code: bonusCode.trim().toUpperCase(),
          bonus_name: bonusName.trim(),
          calculation_type: bonusType,
          base_amount: Number(bonusAmount) || 0,
          is_recurring: bonusRecurring,
          applies_to: 'ALL',
        })
        toast.success(`Đã thiết lập thưởng '${bonusName}' cho kỳ ${bonusPeriod}!`)
      }
      setShowBonusModal(false)
      setEditingBonus(null)
      await fetchBonuses()
    } catch (err: any) {
      console.error('Error saving period bonus:', err)
      toast.error(err.message || 'Lỗi khi lưu khoản thưởng')
    } finally {
      setSavingBonus(false)
    }
  }

  // Xóa khoản thưởng kỳ
  const handleDeleteBonus = async (bonusId: number, name: string) => {
    if (!window.confirm(`Xác nhận xóa khoản thưởng "${name}" của kỳ này?`)) return
    try {
      await payrollApi.deletePeriodBonus(bonusId)
      toast.success('Đã xóa khoản thưởng kỳ!')
      await fetchBonuses()
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi xóa khoản thưởng')
    }
  }

  // Lưu công chuẩn ghi đè cho kỳ
  const handleSaveWorkingDays = async () => {
    if (manualDays <= 0 || manualDays > 31) {
      toast.error('Số ngày công phải từ 0.5 đến 31 ngày')
      return
    }
    setSavingWorkingDays(true)
    try {
      if (isManualOverride) {
        await payrollApi.overrideWorkingDays(selectedWorkingPeriod, {
          override_working_days: Number(manualDays),
          reason: manualReason.trim() || undefined,
        })
        toast.success(`Đã lưu công chuẩn ghi đè (${manualDays} ngày) cho kỳ ${selectedWorkingPeriod}!`)
      } else {
        await payrollApi.resetWorkingDays(selectedWorkingPeriod)
        toast.success(`Đã đặt lại công chuẩn tự động cho kỳ ${selectedWorkingPeriod}!`)
      }
      await fetchWorkingDays(selectedWorkingPeriod)
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi lưu ngày công chuẩn')
    } finally {
      setSavingWorkingDays(false)
    }
  }

  // Đặt lại công chuẩn về tự động theo lịch
  const handleResetWorkingDaysToAuto = async () => {
    setSavingWorkingDays(true)
    try {
      await payrollApi.resetWorkingDays(selectedWorkingPeriod)
      toast.success(`Đã đưa công chuẩn kỳ ${selectedWorkingPeriod} về tính tự động theo lịch!`)
      await fetchWorkingDays(selectedWorkingPeriod)
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi đặt lại công chuẩn')
    } finally {
      setSavingWorkingDays(false)
    }
  }

  // Mở modal thêm ngày lễ
  const handleOpenAddHoliday = () => {
    setEditingHoliday(null)
    setHolidayDate(`${holidayYear}-01-01`)
    setHolidayName('')
    setHolidayNotes('')
    setShowHolidayModal(true)
  }

  // Mở modal sửa ngày lễ
  const handleOpenEditHoliday = (h: PublicHoliday) => {
    setEditingHoliday(h)
    setHolidayDate(h.holiday_date)
    setHolidayName(h.holiday_name)
    setHolidayNotes(h.notes || '')
    setShowHolidayModal(true)
  }

  // Submit tạo/sửa ngày lễ
  const handleSubmitHoliday = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!holidayDate) {
      toast.error('Vui lòng chọn ngày nghỉ')
      return
    }
    if (!holidayName.trim()) {
      toast.error('Vui lòng nhập tên dịp lễ / sự kiện')
      return
    }
    setSavingHoliday(true)
    try {
      if (editingHoliday) {
        await payrollApi.updateHoliday(editingHoliday.holiday_id, {
          holiday_date: holidayDate,
          holiday_name: holidayName.trim(),
          notes: holidayNotes.trim() || undefined,
        })
        toast.success(`Đã cập nhật ngày lễ "${holidayName}"!`)
      } else {
        await payrollApi.createHoliday({
          holiday_date: holidayDate,
          holiday_name: holidayName.trim(),
          notes: holidayNotes.trim() || undefined,
        })
        toast.success(`Đã thêm ngày lễ "${holidayName}"!`)
      }
      setShowHolidayModal(false)
      setEditingHoliday(null)
      await fetchHolidays(holidayYear)
      await fetchWorkingDays(selectedWorkingPeriod)
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi lưu ngày lễ')
    } finally {
      setSavingHoliday(false)
    }
  }

  // Xóa ngày lễ
  const handleDeleteHoliday = async (h: PublicHoliday) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ngày lễ "${h.holiday_name}" (${h.holiday_date})? Ngày công chuẩn của tháng tương ứng sẽ tự động tăng thêm.`)) {
      return
    }
    try {
      await payrollApi.deleteHoliday(h.holiday_id)
      toast.success(`Đã xóa ngày lễ "${h.holiday_name}"!`)
      await fetchHolidays(holidayYear)
      await fetchWorkingDays(selectedWorkingPeriod)
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi xóa ngày lễ')
    }
  }

  // Format ngày hiển thị kèm thứ
  const formatHolidayDateWithDay = (dateStr: string) => {
    if (!dateStr) return { dateFormatted: '', dayName: '', isSunday: false }
    const d = new Date(dateStr)
    const dayName = VIETNAMESE_DAYS[d.getDay()]
    const [year, month, day] = dateStr.split('-')
    return {
      dateFormatted: `${day}/${month}/${year}`,
      dayName: dayName,
      isSunday: d.getDay() === 0
    }
  }

  // Danh sách tham số sau khi lọc
  const filteredSettings = settings.filter(s => {
    const matchesGroup = selectedGroup === 'ALL' || s.setting_group === selectedGroup
    const query = settingSearch.toLowerCase().trim()
    const matchesSearch = !query ||
      s.setting_name.toLowerCase().includes(query) ||
      s.setting_key.toLowerCase().includes(query) ||
      (s.description && s.description.toLowerCase().includes(query))
    return matchesGroup && matchesSearch
  })

  // Danh sách thưởng sau khi lọc
  const filteredBonuses = bonuses.filter(b => {
    const query = bonusSearch.toLowerCase().trim()
    return !query ||
      b.bonus_name.toLowerCase().includes(query) ||
      b.bonus_code.toLowerCase().includes(query) ||
      b.salary_period.includes(query)
  })

  // Danh sách 24 tháng cho dropdown kỳ lương (dùng setDate(1) để chặn tràn tháng khi rơi vào ngày 31)
  const periodOptions = Array.from({ length: 24 }).map((_, i) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i + 2) // Lấy từ 2 tháng tới trở về trước
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  return (
    <div className="modal-overlay no-print">
      <div
        className="modal prd-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Tối Giản */}
        <div className="prd-header">
          <div>
            <h2 className="prd-header-title">
              {isHrOrAdmin ? 'Quy Chế Tính Lương & Tham Số Doanh Nghiệp' : 'Quy Chế & Công Thức Tính Lương TechZone'}
            </h2>
            <p className="prd-header-desc">
              {isHrOrAdmin
                ? 'Cấu hình định mức phụ cấp, phạt trễ, ngày công chuẩn linh hoạt, đa hệ số OT và danh mục ngày lễ'
                : 'Tra cứu chi tiết ngày công chuẩn, định mức phụ cấp, tỷ lệ làm thêm giờ và công thức tính lương áp dụng'}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} title="Đóng">
            {Icons.close}
          </button>
        </div>

        {/* Tab Navigation */}
        {isHrOrAdmin ? (
          <div className="prd-tabs">
            <button
              type="button"
              className={`prd-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <span>Tham số quy chế</span>
              <span className="prd-tab-count">{settings.length}</span>
            </button>

            <button
              type="button"
              className={`prd-tab-btn ${activeTab === 'bonuses' ? 'active' : ''}`}
              onClick={() => setActiveTab('bonuses')}
            >
              <span>Thưởng theo kỳ</span>
              <span className="prd-tab-count">{bonuses.length}</span>
            </button>

            <button
              type="button"
              className={`prd-tab-btn ${activeTab === 'holidays_working_days' ? 'active' : ''}`}
              onClick={() => setActiveTab('holidays_working_days')}
            >
              <span>Lịch Lễ, Tết & Công chuẩn</span>
              <span className="prd-tab-count">{holidays.length}</span>
            </button>

            <button
              type="button"
              className={`prd-tab-btn ${activeTab === 'attendance' ? 'active' : ''}`}
              onClick={() => setActiveTab('attendance')}
            >
              <span>Quy định chấm công</span>
            </button>

            <button
              type="button"
              className={`prd-tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
              onClick={() => setActiveTab('guide')}
            >
              <span>Cẩm nang quy chế</span>
            </button>
          </div>
        ) : (
          <div className="prd-tabs">
            <button
              type="button"
              className={`prd-tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
              onClick={() => setActiveTab('guide')}
            >
              <span>Cẩm nang quy chế & Công thức</span>
            </button>

            <button
              type="button"
              className={`prd-tab-btn ${activeTab === 'attendance' ? 'active' : ''}`}
              onClick={() => setActiveTab('attendance')}
            >
              <span>Quy định chấm công</span>
            </button>
          </div>
        )}

        {/* Nội dung Tab - Scrollable Body */}
        <div className="modal-body prd-body">
          {/* ================================================================= */}
          {/* TAB 1: THAM SỐ QUY CHẾ */}
          {/* ================================================================= */}
          {activeTab === 'settings' && (
            <>
              {/* Toolbar Tối Giản */}
              <div className="prd-toolbar">
                <div className="prd-search-box">
                  <span className="prd-search-icon">{Icons.search}</span>
                  <input
                    type="text"
                    className="prd-search-input"
                    placeholder="Tìm theo tên hoặc mã tham số..."
                    value={settingSearch}
                    onChange={(e) => setSettingSearch(e.target.value)}
                  />
                  {settingSearch && (
                    <button
                      type="button"
                      className="prd-search-clear"
                      onClick={() => setSettingSearch('')}
                      title="Xóa tìm kiếm"
                    >
                      {Icons.close}
                    </button>
                  )}
                </div>

                <div className="prd-chips">
                  {[
                    { id: 'ALL', label: 'Tất cả' },
                    { id: 'ATTENDANCE', label: 'Công & Ca' },
                    { id: 'ALLOWANCE', label: 'Phụ cấp' },
                    { id: 'PENALTY', label: 'Giảm trừ & Phạt' },
                    { id: 'INSURANCE', label: 'Bảo hiểm' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`prd-chip ${selectedGroup === tab.id ? 'active' : ''}`}
                      onClick={() => setSelectedGroup(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bảng Tham Số */}
              {loadingSettings ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Đang tải tham số quy chế...
                </div>
              ) : filteredSettings.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--surface-subtle)', borderRadius: '4px' }}>
                  Không tìm thấy tham số nào khớp với bộ lọc.
                </div>
              ) : (
                <div className="prd-table-card">
                  <table className="prd-table">
                    <thead>
                      <tr>
                        <th style={{ width: '42%' }}>Tham Số & Định Mức</th>
                        <th style={{ width: '16%' }}>Phân Nhóm</th>
                        <th style={{ width: '18%', textAlign: 'right' }}>Giá Trị Áp Dụng</th>
                        <th style={{ width: '10%', textAlign: 'center' }}>Đơn Vị</th>
                        {isHrOrAdmin && <th style={{ width: '14%', textAlign: 'center' }}>Thao Tác</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSettings.map((s) => {
                        const isEditing = editingKey === s.setting_key
                        return (
                          <tr key={s.setting_key}>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                                {s.setting_name}
                              </div>
                              <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                {s.setting_key}
                              </div>
                              {s.description && (
                                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                  {s.description}
                                </div>
                              )}
                            </td>
                            <td>
                              <span className="prd-badge">
                                {s.setting_group === 'PENALTY' ? 'Giảm trừ & Phạt' :
                                 s.setting_group === 'ALLOWANCE' ? 'Phụ cấp' :
                                 s.setting_group === 'INSURANCE' ? 'Bảo hiểm' :
                                 s.setting_group === 'ATTENDANCE' ? 'Công & Ca' : s.setting_group}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {isEditing ? (
                                <input
                                  type="number"
                                  step="any"
                                  value={editValue}
                                  onChange={(e) => setEditValue(parseFloat(e.target.value) || 0)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveSetting(s.setting_key)
                                    if (e.key === 'Escape') setEditingKey(null)
                                  }}
                                  className="form-input"
                                  style={{ textAlign: 'right', padding: '4px 8px', fontSize: '12.5px', width: '100%' }}
                                  autoFocus
                                />
                              ) : (
                                <span className="prd-mono-val">
                                  {s.unit === 'VND' ? formatCurrency(s.numeric_value) :
                                   s.unit === 'TY_LE' ? `${(s.numeric_value * 100).toFixed(1)}%` :
                                   s.unit === 'HE_SO' ? `${s.numeric_value}x` : s.numeric_value}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
                              {s.unit === 'VND' ? 'VNĐ' :
                               s.unit === 'TY_LE' ? 'Tỷ lệ' :
                               s.unit === 'HE_SO' ? 'Hệ số' :
                               s.unit === 'PHUT' ? 'Phút' :
                               s.unit === 'NGAY' ? 'Ngày' : s.unit}
                            </td>
                            {isHrOrAdmin && (
                              <td style={{ textAlign: 'center' }}>
                                {isEditing ? (
                                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
                                      onClick={() => handleSaveSetting(s.setting_key)}
                                      disabled={savingKey === s.setting_key}
                                    >
                                      Lưu
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
                                      onClick={() => setEditingKey(null)}
                                      disabled={savingKey === s.setting_key}
                                    >
                                      Hủy
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '3px 10px', fontSize: '11.5px', height: '26px' }}
                                    onClick={() => {
                                      setEditingKey(s.setting_key)
                                      setEditValue(Number(s.numeric_value))
                                      setEditDesc(s.description || '')
                                    }}
                                  >
                                    Chỉnh sửa
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ================================================================= */}
          {/* TAB 2: THƯỞNG THEO KỲ */}
          {/* ================================================================= */}
          {activeTab === 'bonuses' && (
            <>
              <div className="prd-toolbar">
                <div className="prd-search-box">
                  <span className="prd-search-icon">{Icons.search}</span>
                  <input
                    type="text"
                    className="prd-search-input"
                    placeholder="Tìm theo tên hoặc kỳ lương (VD: 2026-09)..."
                    value={bonusSearch}
                    onChange={(e) => setBonusSearch(e.target.value)}
                  />
                </div>

                {isHrOrAdmin && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleOpenCreateBonus}
                    style={{ height: '30px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {Icons.plus}
                    Thêm khoản thưởng kỳ
                  </button>
                )}
              </div>

              {loadingBonuses ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Đang tải danh mục thưởng kỳ...
                </div>
              ) : filteredBonuses.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--surface-subtle)', borderRadius: '4px' }}>
                  Chưa có khoản thưởng sự kiện nào được cấu hình. Bấm "Thêm khoản thưởng kỳ" để thiết lập.
                </div>
              ) : (
                <div className="prd-table-card">
                  <table className="prd-table">
                    <thead>
                      <tr>
                        <th style={{ width: '15%' }}>Kỳ Lương</th>
                        <th style={{ width: '35%' }}>Khoản Thưởng & Mã</th>
                        <th style={{ width: '20%' }}>Cách Tính</th>
                        <th style={{ width: '18%', textAlign: 'right' }}>Mức Cơ Sở</th>
                        {isHrOrAdmin && <th style={{ width: '12%', textAlign: 'center' }}>Thao Tác</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBonuses.map((b) => (
                        <tr key={b.bonus_id}>
                          <td>
                            <span className="prd-mono-val">{b.salary_period}</span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.bonus_name}</div>
                            <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{b.bonus_code}</div>
                          </td>
                          <td>
                            <span className="prd-badge">
                              {b.calculation_type === 'COEFFICIENT' ? 'Nhân hệ số chức vụ' :
                               b.calculation_type === 'CONTRACT_SALARY' ? '1 tháng lương HĐ' : 'Số tiền cố định'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="prd-mono-val">
                              {b.calculation_type === 'CONTRACT_SALARY' ? '100% Lương HĐ' : formatCurrency(b.base_amount)}
                            </span>
                          </td>
                          {isHrOrAdmin && (
                            <td style={{ textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 8px', fontSize: '11px', height: '26px' }}
                                  onClick={() => handleOpenEditBonus(b)}
                                >
                                  Sửa
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 8px', fontSize: '11px', height: '26px', color: 'var(--status-error)' }}
                                  onClick={() => handleDeleteBonus(b.bonus_id, b.bonus_name)}
                                >
                                  Xóa
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ================================================================= */}
          {/* TAB 3: LỊCH LỄ, TẾT & CÔNG CHUẨN */}
          {/* ================================================================= */}
          {activeTab === 'holidays_working_days' && (
            <div className="prd-working-days-panel">
              {/* 1. THIẾT LẬP CÔNG CHUẨN THEO KỲ LƯƠNG */}
              <div className="prd-section-card">
                <div className="prd-section-title-row">
                  <div className="prd-section-heading">1. Thiết lập ngày công chuẩn theo kỳ lương</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Kỳ lương:</span>
                    <select
                      className="form-select"
                      value={selectedWorkingPeriod}
                      onChange={(e) => setSelectedWorkingPeriod(e.target.value)}
                      style={{ width: '130px', height: '30px', fontSize: '12px' }}
                    >
                      {periodOptions.map(p => (
                        <option key={p} value={p}>Tháng {p.split('-')[1]}/{p.split('-')[0]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {loadingWorkingDays ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12.5px' }}>
                    Đang tải thông số ngày công chuẩn...
                  </div>
                ) : workingDaysData ? (
                  <>
                    <div className="prd-stat-grid-4">
                      <div className="prd-stat-box">
                        <div className="prd-stat-box-label">Tổng số ngày</div>
                        <div className="prd-stat-box-value">{workingDaysData.calendar_days}</div>
                      </div>

                      <div className="prd-stat-box">
                        <div className="prd-stat-box-label">Số ngày Chủ Nhật</div>
                        <div className="prd-stat-box-value">{workingDaysData.sundays_count}</div>
                      </div>

                      <div className="prd-stat-box">
                        <div className="prd-stat-box-label">Lễ, Tết (T2-T7)</div>
                        <div className="prd-stat-box-value">{workingDaysData.holidays_count}</div>
                      </div>

                      <div className="prd-stat-box highlight">
                        <div className="prd-stat-box-label">Công chuẩn tự động</div>
                        <div className="prd-stat-box-value">{workingDaysData.auto_standard_days} ngày</div>
                      </div>
                    </div>

                    {workingDaysData.is_locked ? (
                      <div className="prd-lock-notice">
                        <span style={{ display: 'flex', alignItems: 'center' }}>{Icons.lock}</span>
                        <span>
                          Kỳ lương đã chốt hoặc thanh toán. Công chuẩn được khóa cố định theo bảng lương: <strong>{workingDaysData.applied_standard_days} ngày</strong>. (Mở lại kỳ lương tại trang Quản lý bảng lương nếu cần điều chỉnh).
                        </span>
                      </div>
                    ) : (
                      <div className="prd-override-form">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}>
                            <input
                              type="checkbox"
                              checked={isManualOverride}
                              onChange={(e) => setIsManualOverride(e.target.checked)}
                            />
                            <span>Ghi đè ngày công chuẩn thủ công (Manual Override)</span>
                          </label>

                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            Công chuẩn áp dụng: <strong style={{ color: 'var(--text-primary)' }}>{workingDaysData.applied_standard_days} ngày</strong>
                            <span className="prd-badge" style={{ marginLeft: '6px' }}>
                              {workingDaysData.is_manual_override ? 'Ghi đè thủ công' : 'Tính tự động theo lịch'}
                            </span>
                          </div>
                        </div>

                        {isManualOverride && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '2px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <div style={{ width: '130px' }}>
                                <label className="form-label" style={{ fontSize: '11px', marginBottom: '4px' }}>Số ngày công</label>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="1"
                                  max="31"
                                  value={manualDays}
                                  onChange={(e) => setManualDays(parseFloat(e.target.value) || 0)}
                                  className="form-input"
                                  style={{ textAlign: 'right', fontWeight: 600 }}
                                />
                              </div>

                              <div style={{ flex: 1, minWidth: '220px' }}>
                                <label className="form-label" style={{ fontSize: '11px', marginBottom: '4px' }}>Lý do điều chỉnh</label>
                                <input
                                  type="text"
                                  value={manualReason}
                                  onChange={(e) => setManualReason(e.target.value)}
                                  placeholder="Nhập lý do điều chỉnh công chuẩn..."
                                  className="form-input"
                                />
                              </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleResetWorkingDaysToAuto}
                                disabled={savingWorkingDays || !workingDaysData.is_manual_override}
                                style={{ height: '30px', fontSize: '11.5px' }}
                              >
                                Đặt lại tự động ({workingDaysData.auto_standard_days} ngày)
                              </button>

                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleSaveWorkingDays}
                                disabled={savingWorkingDays}
                                style={{ height: '30px', fontSize: '11.5px' }}
                              >
                                {savingWorkingDays ? 'Đang lưu...' : 'Lưu công chuẩn kỳ này'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              {/* 2. DANH MỤC NGÀY NGHỈ LỄ, TẾT & NGHỈ BÙ */}
              <div className="prd-section-card">
                <div className="prd-section-title-row">
                  <div className="prd-section-heading">2. Danh mục ngày nghỉ Lễ, Tết & nghỉ bù (Điều 112 BLLĐ)</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Năm:</span>
                    <select
                      className="form-select"
                      value={holidayYear}
                      onChange={(e) => setHolidayYear(Number(e.target.value))}
                      style={{ width: '90px', height: '30px', fontSize: '12px' }}
                    >
                      {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>

                    {isHrOrAdmin && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleOpenAddHoliday}
                        style={{ height: '30px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        {Icons.plus}
                        Thêm ngày nghỉ
                      </button>
                    )}
                  </div>
                </div>

                {loadingHolidays ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12.5px' }}>
                    Đang tải danh mục ngày nghỉ lễ...
                  </div>
                ) : holidays.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--surface-subtle)', borderRadius: '4px', fontSize: '12.5px' }}>
                    Chưa có ngày nghỉ lễ nào cho năm {holidayYear}. Bấm "Thêm ngày nghỉ" để khởi tạo.
                  </div>
                ) : (
                  <div className="prd-table-card">
                    <table className="prd-table">
                      <thead>
                        <tr>
                          <th style={{ width: '16%' }}>Ngày Nghỉ</th>
                          <th style={{ width: '14%' }}>Thứ</th>
                          <th style={{ width: '36%' }}>Dịp Lễ / Sự Kiện</th>
                          <th style={{ width: '22%' }}>Ghi Chú</th>
                          {isHrOrAdmin && <th style={{ width: '12%', textAlign: 'center' }}>Thao Tác</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {holidays.map(h => {
                          const dateInfo = formatHolidayDateWithDay(h.holiday_date)
                          return (
                            <tr key={h.holiday_id}>
                              <td>
                                <span className="prd-mono-val">{dateInfo.dateFormatted}</span>
                              </td>
                              <td>
                                <span className="prd-badge">{dateInfo.dayName}</span>
                              </td>
                              <td>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{h.holiday_name}</div>
                              </td>
                              <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                {h.notes || '—'}
                              </td>
                              {isHrOrAdmin && (
                                <td style={{ textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{ padding: '2px 8px', fontSize: '11px', height: '26px' }}
                                      onClick={() => handleOpenEditHoliday(h)}
                                    >
                                      Sửa
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{ padding: '2px 8px', fontSize: '11px', height: '26px', color: 'var(--status-error)' }}
                                      onClick={() => handleDeleteHoliday(h)}
                                    >
                                      Xóa
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB: QUY ĐỊNH CHẤM CÔNG & ĐỐI SOÁT CÔNG VỚI BẢNG LƯƠNG */}
          {/* ================================================================= */}
          {activeTab === 'attendance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm, 6px)',
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'rgba(37, 99, 235, 0.1)',
                  color: 'var(--primary-color, #2563eb)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px',
                }}>
                  {Icons.clock}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                    Quy Định Ghi Nhận Phiên Chấm Công & Đối Soát Bảng Lương
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.5 }}>
                    Mỗi phiên làm việc của nhân viên được hệ thống tự động đối chiếu ca làm việc, thời gian check-in / check-out, thời gian đi muộn / về sớm và giờ OT để làm căn cứ tính lương minh bạch, chính xác.
                  </div>
                </div>
              </div>

              {/* BẢNG QUY TẮC PHIÊN CHẤM CÔNG */}
              <div className="prd-table-card">
                <table className="prd-table">
                  <thead>
                    <tr>
                      <th style={{ width: '22%' }}>Nội dung</th>
                      <th style={{ width: '48%' }}>Quy định áp dụng</th>
                      <th style={{ width: '30%' }}>Tác động bảng lương</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Ca được phân công</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Phân ca & Chụp phiên</div>
                      </td>
                      <td>
                        Check-in đối chiếu ca và cửa hàng đã phân công trước. Khi nhân viên check-in, thông tin ca (giờ bắt đầu, kết thúc, số giờ ca chuẩn) được lưu làm bản chụp (snapshot) cố định để tính công về sau, không bị sai lệch nếu lịch bị đổi sau đó.
                      </td>
                      <td>
                        <span className="prd-badge">CĂN CỨ CÔNG</span>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Xác định số giờ chuẩn cần hoàn thành trong ngày làm việc.
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td>
                        <strong>Quy tắc đi muộn (Grace period)</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Ân hạn 15 phút</div>
                      </td>
                      <td>
                        Phút trễ tính từ giờ bắt đầu của chính ca đó. Hệ thống chỉ gắn nhãn <code>LATE</code> và ghi nhận vi phạm khi trễ quá 15 phút (ví dụ: ca 13:00 thì sau 13:15 mới bị đánh dấu muộn).
                      </td>
                      <td>
                        <span className="prd-badge">PHẠT CHUYÊN CẦN</span>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Trễ &gt; 15p bị trừ chuyên cần theo mức phạt quy chế (<code>LATE_PENALTY_AMOUNT</code>) + trừ theo số phút thiếu.
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td>
                        <strong>Về sớm & Làm thêm giờ (OT)</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Checkout ca</div>
                      </td>
                      <td>
                        Checkout trước giờ kết thúc ca ghi nhận <code>early_minutes</code>. Làm vượt số giờ của ca được ghi nhận <code>overtime_hours</code> thực tế. Mọi giờ OT đưa vào tính lương bắt buộc phải có đơn OT đã được Quản lý / HR phê duyệt.
                      </td>
                      <td>
                        <span className="prd-badge">LƯƠNG OT & KHẤU TRỪ</span>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          OT được nhân hệ số 1.5x, 2.0x, 3.0x. Về sớm bị trừ vào tiền lương thiếu thời gian nếu không có lý do hợp lệ.
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td>
                        <strong>Nhãn phiên chấm công</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Thứ tự ưu tiên</div>
                      </td>
                      <td>
                        Ưu tiên nhãn hiển thị: <code>LATE_AND_EARLY</code> → <code>LATE</code> → <code>EARLY</code> → <code>OVERTIME</code> → <code>NORMAL</code>. Dù nhãn tóm tắt là gì, hệ thống vẫn lưu trữ độc lập chính xác số giờ làm, số phút trễ, phút sớm và giờ OT.
                      </td>
                      <td>
                        <span className="prd-badge">ĐỐI SOÁT TRƯỜNG SỐ</span>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Bảng lương chỉ đối chiếu trường số thực tế, không suy đoán phạt/thưởng từ nhãn phiên.
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td>
                        <strong>Khoảng chờ an toàn (Anti-spam)</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Chống thao tác nhầm</div>
                      </td>
                      <td>
                        Checkout chỉ thực hiện sau ít nhất 60 giây kể từ khi check-in. Sau khi checkout, cần chờ tối thiểu 60 giây trước lượt check-in tiếp theo để ngăn ngừa thao tác đúp hoặc lỗi kết nối.
                      </td>
                      <td>
                        <span className="prd-badge">TOÀN VẸN DỮ LIỆU</span>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Tránh tạo ra các phiên rác hoặc thời lượng 0 giờ trong kỳ tính lương.
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* LƯU Ý ĐỐI CHIẾU BẢNG LƯƠNG */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">Nguyên Tắc Kết Nối Chấm Công Với Phiếu Lương (Payroll Reconcile)</h4>
                  <span className="prd-badge">ĐỐI SOÁT TỰ ĐỘNG</span>
                </div>
                <div className="prd-rule-list">
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Ngày công thực tế:</strong> Tổng ngày có check-in hợp lệ trong kỳ tính lương (<code>attendance_actual_days</code>) kết hợp cùng ngày nghỉ phép hưởng lương (<code>paid_leave_days</code>) cấu thành công hưởng lương chính thức.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Giờ làm thêm OT được tính tiền:</strong> Chỉ số giờ làm thêm có đơn đăng ký OT và đã được cấp có thẩm quyền phê duyệt chính thức (<code>approved_overtime_hours</code>) mới được đưa vào bảng tính lương với các hệ số tương ứng (150% ngày thường, 200% Chủ Nhật, 300% Lễ Tết).</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Khấu trừ đi trễ / về sớm:</strong> Tổng phút thiếu hụt do đi trễ và về sớm chưa xin phép sẽ được quy đổi thành số tiền khấu trừ thời gian thiếu (<code>time_deduction_amount</code>) dựa trên đơn giá lương theo phút của nhân viên.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Trạng thái phiên là nhãn tóm tắt:</strong> Bảng lương đối soát trên các trường số giờ, số phút thực tế và quyết định phê duyệt OT, tuyệt đối không suy đoán thưởng hoặc phạt tùy tiện chỉ từ nhãn trạng thái của phiên.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: CẨM NANG QUY CHẾ TÍNH LƯƠNG & CÔNG THỨC */}
          {/* ================================================================= */}
          {activeTab === 'guide' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 1. LƯƠNG CƠ BẢN & NGÀY CÔNG */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">1. Lương Cơ Bản, Ngày Công Chuẩn & Hệ Số OT (Điều 98 BLLĐ 2019)</h4>
                  <span className="prd-badge">CÔNG & CA</span>
                </div>

                <div className="prd-rule-formula">
                  Lương CB thực nhận = (Lương Hợp Đồng / D_std) × (Công Đi Làm Thực Tế + Công Nghỉ Phép Hưởng Lương)
                </div>

                <div className="prd-rule-list">
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Ngày công chuẩn tháng (D_std):</strong> Tự động tính theo lịch thực tế từng tháng = <code>Tổng ngày trong tháng - Số ngày Chủ Nhật - Số ngày Lễ/Tết (Thứ 2 đến Thứ 7)</code>. Ban Giám đốc có thể ghi đè thủ công cho kỳ lương tại Tab <em>"Lịch Lễ, Tết & Công chuẩn"</em>.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Nghỉ phép hưởng lương:</strong> Nghỉ phép năm (Annual Leave) được duyệt tính đủ 1.0 ngày công.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Làm thêm giờ đa hệ số (OT Bóc Tách):</strong> Lương 1 giờ = <code>Lương HĐ / D_std / 8</code>. Áp dụng 3 hệ số chuẩn luật định:
                      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                        <li><strong>1.5x (150%):</strong> Làm thêm ngày làm việc bình thường (Thứ Hai đến Thứ Bảy).</li>
                        <li><strong>2.0x (200%):</strong> Làm thêm ngày nghỉ hằng tuần (Chủ Nhật).</li>
                        <li><strong>3.0x (300%):</strong> Làm thêm ngày nghỉ Lễ, Tết theo luật định (bao gồm cả các ngày nghỉ bù chính thức).</li>
                      </ul>
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. CÁC KHOẢN PHỤ CẤP */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">2. Chế Độ Phụ Cấp Bán Lẻ & Dự Án</h4>
                  <span className="prd-badge">PHỤ CẤP</span>
                </div>

                <div className="prd-rule-formula">
                  Tổng Phụ Cấp = Phụ Cấp Cơm Xe + Phụ Cấp Chức Vụ + Σ Phụ Cấp Vai Trò Dự Án
                </div>

                <div className="prd-rule-list">
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Cơm trưa & Đi lại:</strong> Định mức 1.000.000 đ/tháng (áp dụng toàn thể nhân sự chính thức).</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Phụ cấp Chức vụ:</strong> Cửa hàng trưởng (1.500.000 đ/tháng) • Phó CHT (800.000 đ/tháng) • Trưởng nhóm (500.000 đ/tháng).</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Phụ cấp Dự án Công nghệ:</strong> Tra cứu theo vai trò thành viên dự án (PM: 2.000.000 đ • Tech Lead: 1.500.000 đ • Nòng cốt: 1.000.000 đ • Hỗ trợ: 500.000 đ).</span>
                  </div>
                </div>
              </div>

              {/* 3. HOA HỒNG & THƯỞNG */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">3. Hoa Hồng Ngành Hàng & Thưởng Hiệu Suất</h4>
                  <span className="prd-badge">DOANH SỐ & KPI</span>
                </div>

                <div className="prd-rule-formula">
                  Hoa Hồng = (Doanh Số Phone × 1.0%) + (Doanh Số Laptop × 1.0%) + (Phụ Kiện & Âm Thanh × 3.0%)
                </div>

                <div className="prd-rule-list">
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Hoa hồng bán lẻ:</strong> Trích theo tỷ lệ ngành hàng từ đơn hàng hoàn tất của nhân viên tư vấn.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Thưởng KPI cuối tháng:</strong> Đạt 100% KPI: 1.000.000 đ • Vượt trội ≥ 120% KPI: 2.000.000 đ.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Thưởng kỳ (Tết, Lễ 30/4, 2/9, Tháng 13):</strong> Cấu hình linh hoạt theo từng kỳ lương tại Tab "Thưởng theo kỳ".</span>
                  </div>
                </div>
              </div>

              {/* 4. KHẤU TRỪ & BẢO HIỂM */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">4. Khấu Trừ Thời Gian, Phạt Đi Trễ & Bảo Hiểm Bắt Buộc</h4>
                  <span className="prd-badge">KHẤU TRỪ</span>
                </div>

                <div className="prd-rule-formula">
                  Tổng Khấu Trừ = (Lương Ngày × Ngày Nghỉ K.Lương) + (Lần Trễ Quá 15p × 50.000 đ) + (Lương Đóng BH × 10.5%)
                </div>

                <div className="prd-rule-list">
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Phạt đi trễ ca:</strong> Đi trễ quá 15 phút so với giờ bắt đầu ca sẽ bị phạt 50.000 đ/lần.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Nghỉ không lương:</strong> Khấu trừ trực tiếp <code>(Lương HĐ / D_std) × Số ngày nghỉ</code>.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Bảo hiểm bắt buộc (Tổng 10.5%):</strong> BHXH 8.0% • BHYT 1.5% • BHTN 1.0%.</span>
                  </div>
                </div>
              </div>

              {/* 5. QUY TRÌNH PHÊ DUYỆT 3 CẤP & KHÓA BẢO VỆ 3 LỚP */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">5. Quy Trình Kiểm Soát 3 Cấp & Cơ Chế Khóa Bất Biến</h4>
                  <span className="prd-badge">QUY TRÌNH & BẢO MẬT</span>
                </div>

                <div className="prd-steps-row">
                  <div className="prd-step-box">
                    <span className="prd-step-num">CẤP 1 • SOẠN THẢO</span>
                    <span className="prd-step-role">Kế Toán / Cửa Hàng Trưởng</span>
                    <span className="prd-step-desc">Tính toán sơ bộ từ Chấm công & POS, rà soát ngoại lệ, tạo bảng lương nháp (DRAFT).</span>
                  </div>

                  <div className="prd-step-box">
                    <span className="prd-step-num">CẤP 2 • THẨM ĐỊNH</span>
                    <span className="prd-step-role">Trưởng Phòng Nhân Sự</span>
                    <span className="prd-step-desc">Kiểm tra công chuẩn, phụ cấp dự án, giải trình phạt và xác nhận phê duyệt (CONFIRMED).</span>
                  </div>

                  <div className="prd-step-box">
                    <span className="prd-step-num">CẤP 3 • QUYẾT TOÁN</span>
                    <span className="prd-step-role">Giám Đốc Điều Hành</span>
                    <span className="prd-step-desc">Phê duyệt cấp cao cuối cùng, xuất lệnh chuyển khoản ngân hàng và khóa sổ chi trả (PAID).</span>
                  </div>
                </div>

                <div className="prd-rule-list" style={{ marginTop: '2px' }}>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Khóa bất biến 3 lớp (3-Tier Locking):</strong> Mọi kỳ lương đã CONFIRMED hoặc PAID đều được khóa chặt ở cả 3 tầng (Database Trigger $\rightarrow$ Backend API $\rightarrow$ Frontend UI).</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Mở khóa có kiểm soát (Reopen Period):</strong> Khi cần điều chỉnh kỳ đã chốt, HR/Director sử dụng quy trình Mở lại kỳ lương kèm ghi nhận lý do vào vết kiểm toán <code>audit_logs</code>.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="prd-footer">
          <div className="prd-footer-note">
            Đồng bộ theo Bộ luật Lao động 2019 & Quy chế TechZone Retail
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-MODAL 1: THIẾT LẬP THƯỞNG KỲ */}
      {/* ========================================================================= */}
      {showBonusModal && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1200, background: 'rgba(0, 0, 0, 0.6)' }}
        >
          <div
            className="modal prd-submodal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3 className="modal-title" style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                  {editingBonus ? 'Chỉnh Sửa Khoản Thưởng Kỳ' : 'Thiết Lập Thưởng Kỳ Mới'}
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {editingBonus ? `Mã: ${editingBonus.bonus_code} (Kỳ ${editingBonus.salary_period})` : 'Khoản thưởng áp dụng trực tiếp vào kỳ lương'}
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowBonusModal(false)}
                title="Đóng popup"
              >
                {Icons.close}
              </button>
            </div>

            <form onSubmit={handleSubmitBonus}>
              <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {!editingBonus && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Mẫu gợi ý khoản thưởng</label>
                    <select
                      className="form-select"
                      value={selectedPreset}
                      onChange={(e) => handleSelectPreset(e.target.value)}
                    >
                      <option value="">-- Chọn mẫu điền nhanh --</option>
                      {BONUS_PRESETS.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name} ({p.month ? `Tháng ${p.month}` : ''})
                        </option>
                      ))}
                      <option value="CUSTOM">Khác (Tự định nghĩa)</option>
                    </select>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Kỳ lương (YYYY-MM) *</label>
                    <input
                      type="text"
                      pattern="^[0-9]{4}-(0[1-9]|1[0-2])$"
                      placeholder="VD: 2026-09"
                      value={bonusPeriod}
                      onChange={(e) => setBonusPeriod(e.target.value)}
                      disabled={Boolean(editingBonus)}
                      className="form-input"
                      required
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Mã khoản thưởng *</label>
                    <input
                      type="text"
                      placeholder="VD: TET_BONUS"
                      value={bonusCode}
                      onChange={(e) => setBonusCode(e.target.value.toUpperCase())}
                      disabled={Boolean(editingBonus)}
                      className="form-input"
                      required
                    />
                  </div>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Tên khoản thưởng *</label>
                  <input
                    type="text"
                    placeholder="VD: Thưởng Lễ Quốc Khánh 2/9"
                    value={bonusName}
                    onChange={(e) => setBonusName(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Cách tính thưởng</label>
                    <select
                      className="form-select"
                      value={bonusType}
                      onChange={(e) => setBonusType(e.target.value)}
                    >
                      <option value="COEFFICIENT">Hệ số chức vụ × Mức cơ sở</option>
                      <option value="FIXED_AMOUNT">Số tiền cố định toàn bộ</option>
                      <option value="CONTRACT_SALARY">1 tháng lương Hợp đồng</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">
                      {bonusType === 'CONTRACT_SALARY' ? 'Mức cơ sở (Không áp dụng)' : 'Mức tiền cơ sở (VNĐ) *'}
                    </label>
                    <input
                      type="number"
                      step="50000"
                      min="0"
                      value={bonusAmount}
                      onChange={(e) => setBonusAmount(parseFloat(e.target.value) || 0)}
                      disabled={bonusType === 'CONTRACT_SALARY'}
                      className="form-input"
                      style={{ textAlign: 'right' }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '2px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                    <input
                      type="checkbox"
                      checked={bonusRecurring}
                      onChange={(e) => setBonusRecurring(e.target.checked)}
                    />
                    <span>Lặp lại tự động vào các năm sau</span>
                  </label>
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '12px 20px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowBonusModal(false)}
                  disabled={savingBonus}
                  style={{ height: '30px', fontSize: '12px' }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingBonus}
                  style={{ height: '30px', fontSize: '12px' }}
                >
                  {savingBonus ? 'Đang lưu...' : (editingBonus ? 'Cập nhật' : 'Tạo mới')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-MODAL 2: THÊM / CHỈNH SỬA NGÀY NGHỈ LỄ, TẾT */}
      {/* ========================================================================= */}
      {showHolidayModal && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1200, background: 'rgba(0, 0, 0, 0.6)' }}
        >
          <div
            className="modal prd-submodal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px' }}
          >
            <div className="modal-header">
              <div>
                <h3 className="modal-title" style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                  {editingHoliday ? 'Chỉnh Sửa Ngày Nghỉ Lễ/Tết' : 'Thêm Ngày Nghỉ Lễ/Tết Mới'}
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Hưởng nguyên lương & nhân hệ số 3.0x khi làm thêm giờ (OT)
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowHolidayModal(false)}
                title="Đóng popup"
              >
                {Icons.close}
              </button>
            </div>

            <form onSubmit={handleSubmitHoliday}>
              <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Ngày nghỉ *</label>
                  <input
                    type="date"
                    value={holidayDate}
                    onChange={(e) => setHolidayDate(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Dịp Lễ / Sự kiện *</label>
                  <input
                    type="text"
                    value={holidayName}
                    onChange={(e) => setHolidayName(e.target.value)}
                    placeholder="VD: Nghỉ bù Giỗ Tổ Hùng Vương"
                    className="form-input"
                    required
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Ghi chú</label>
                  <input
                    type="text"
                    value={holidayNotes}
                    onChange={(e) => setHolidayNotes(e.target.value)}
                    placeholder="VD: Theo Thông báo nghỉ lễ của Chính phủ"
                    className="form-input"
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '12px 20px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowHolidayModal(false)}
                  disabled={savingHoliday}
                  style={{ height: '30px', fontSize: '12px' }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingHoliday}
                  style={{ height: '30px', fontSize: '12px' }}
                >
                  {savingHoliday ? 'Đang lưu...' : (editingHoliday ? 'Cập nhật' : 'Thêm mới')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
