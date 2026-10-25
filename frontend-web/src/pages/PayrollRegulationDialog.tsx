import React, { useState, useEffect } from 'react'
import { Icons } from '../components/common/Icons'
import { payrollApi } from '../services/api'
import type { PayrollPolicySetting, PayrollPeriodBonus } from '../types'
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

export function PayrollRegulationDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const isHrOrAdmin = user?.roles?.some((r: string) => ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(r))

  // 3 Tabs: 'settings' | 'bonuses' | 'guide'
  const [activeTab, setActiveTab] = useState<'settings' | 'bonuses' | 'guide'>('settings')

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

  // Dropdown menu thao tác mở cho ID/Key nào (tương tự LeaveRequestsPage)
  const [openMenuId, setOpenMenuId] = useState<string | number | null>(null)

  // Đóng dropdown khi click bên ngoài
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Tải danh sách cấu hình tham số
  const fetchSettings = async () => {
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

  // Tải danh sách thưởng kỳ
  const fetchBonuses = async () => {
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

  useEffect(() => {
    if (activeTab === 'settings') {
      fetchSettings()
    } else if (activeTab === 'bonuses') {
      fetchBonuses()
    }
  }, [activeTab])

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

  // Chọn mẫu gợi ý
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
              Quy Chế Tính Lương & Tham Số Doanh Nghiệp
            </h2>
            <p className="prd-header-desc">
              Cấu hình định mức phụ cấp, phạt trễ, ngày công chuẩn và quy chế tính toán lương
            </p>
          </div>
          <button className="modal-close" onClick={onClose} title="Đóng">
            {Icons.close}
          </button>
        </div>

        {/* Tab Navigation - Tối Giản (Không icon thừa thãi) */}
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
            className={`prd-tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
            onClick={() => setActiveTab('guide')}
          >
            <span>Quy chế & công thức</span>
          </button>
        </div>

        {/* Nội dung Tab - Scrollable Body */}
        <div className="modal-body prd-body">
          {/* ================================================================= */}
          {/* TAB 1: THAM SỐ QUY CHẾ */}
          {/* ================================================================= */}
          {activeTab === 'settings' && (
            <>
              {/* Toolbar Tối Giản: Tìm kiếm & Lọc Nhóm */}
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
                                  style={{
                                    width: '100%',
                                    maxWidth: '120px',
                                    height: '28px',
                                    padding: '2px 8px',
                                    fontSize: '12.5px',
                                    textAlign: 'right',
                                    fontFamily: 'var(--font-mono)',
                                    display: 'inline-block',
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <span className="prd-mono-val">
                                  {s.unit === 'VND' ? formatCurrency(s.numeric_value) :
                                   s.unit === 'TY_LE' ? `${(s.numeric_value * 100).toFixed(1)}%` :
                                   s.numeric_value}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center', fontSize: '11.5px', color: 'var(--text-tertiary)' }}>
                              {s.unit || '—'}
                            </td>
                            {isHrOrAdmin && (
                              <td className="prd-action-cell">
                                {isEditing ? (
                                  <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      style={{ padding: '0 8px', height: '26px', fontSize: '11px', gap: '4px' }}
                                      onClick={() => handleSaveSetting(s.setting_key)}
                                      disabled={savingKey === s.setting_key}
                                      title="Lưu"
                                    >
                                      {Icons.check} {savingKey === s.setting_key ? '...' : 'Lưu'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      style={{ padding: '0 6px', height: '26px', fontSize: '11px' }}
                                      onClick={() => setEditingKey(null)}
                                      title="Hủy"
                                    >
                                      {Icons.close}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="prd-action-group">
                                    {/* Nút 1: Chỉnh sửa (theo LeaveRequestsPage) */}
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm btn-icon"
                                      title="Chỉnh sửa tham số"
                                      onClick={() => {
                                        setEditingKey(s.setting_key)
                                        setEditValue(s.numeric_value)
                                        setEditDesc(s.description || '')
                                      }}
                                    >
                                      {Icons.edit}
                                    </button>

                                    {/* Nút 2: Tùy chọn 3 chấm (theo LeaveRequestsPage) */}
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm btn-icon"
                                      title="Tùy chọn thao tác"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setOpenMenuId(openMenuId === s.setting_key ? null : s.setting_key)
                                      }}
                                    >
                                      {Icons.moreVertical}
                                    </button>

                                    {/* Dropdown Menu thao tác (sử dụng action-dropdown từ App.css như LeaveRequestsPage) */}
                                    {openMenuId === s.setting_key && (
                                      <div
                                        className="action-dropdown"
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                          position: 'absolute',
                                          top: '100%',
                                          right: 0,
                                          marginTop: '4px',
                                          zIndex: 80,
                                          minWidth: '180px',
                                        }}
                                      >
                                        <button
                                          type="button"
                                          className="action-dropdown-item"
                                          onClick={() => {
                                            setOpenMenuId(null)
                                            setEditingKey(s.setting_key)
                                            setEditValue(s.numeric_value)
                                            setEditDesc(s.description || '')
                                          }}
                                        >
                                          <span className="action-icon">{Icons.edit}</span>
                                          <span>Điều chỉnh giá trị</span>
                                        </button>
                                        <button
                                          type="button"
                                          className="action-dropdown-item"
                                          onClick={() => {
                                            setOpenMenuId(null)
                                            setActiveTab('guide')
                                          }}
                                        >
                                          <span className="action-icon">{Icons.info}</span>
                                          <span>Xem quy chế áp dụng</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
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
              {/* Toolbar Tối Giản */}
              <div className="prd-toolbar">
                <div className="prd-search-box">
                  <span className="prd-search-icon">{Icons.search}</span>
                  <input
                    type="text"
                    className="prd-search-input"
                    placeholder="Tìm theo tên khoản thưởng, kỳ lương (YYYY-MM)..."
                    value={bonusSearch}
                    onChange={(e) => setBonusSearch(e.target.value)}
                  />
                  {bonusSearch && (
                    <button
                      type="button"
                      className="prd-search-clear"
                      onClick={() => setBonusSearch('')}
                      title="Xóa tìm kiếm"
                    >
                      {Icons.close}
                    </button>
                  )}
                </div>

                {isHrOrAdmin && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleOpenCreateBonus}
                    style={{ height: '30px', padding: '0 12px', gap: '4px' }}
                  >
                    {Icons.plus}
                    <span>Thiết lập thưởng kỳ</span>
                  </button>
                )}
              </div>

              {/* Bảng Danh Sách Thưởng Kỳ */}
              {loadingBonuses ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Đang tải danh mục thưởng kỳ...
                </div>
              ) : filteredBonuses.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--surface-subtle)', borderRadius: '4px' }}>
                  Chưa có khoản thưởng kỳ nào được cấu hình.
                </div>
              ) : (
                <div className="prd-table-card">
                  <table className="prd-table">
                    <thead>
                      <tr>
                        <th style={{ width: '15%' }}>Kỳ Lương</th>
                        <th style={{ width: '37%' }}>Khoản Thưởng</th>
                        <th style={{ width: '22%' }}>Cách Thức Tính</th>
                        <th style={{ width: '14%', textAlign: 'right' }}>Mức Cơ Sở</th>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                                {b.bonus_name}
                              </span>
                              {b.is_recurring && (
                                <span className="prd-badge" style={{ fontSize: '10.5px' }}>
                                  Hàng năm
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                              {b.bonus_code}
                            </div>
                          </td>
                          <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {b.calculation_type === 'COEFFICIENT' && 'Hệ số chức vụ (Mức CS × Coef)'}
                            {b.calculation_type === 'FIXED_AMOUNT' && 'Tiền cố định cho toàn nhân viên'}
                            {b.calculation_type === 'CONTRACT_SALARY' && '1 Tháng lương hợp đồng (Tháng 13)'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="prd-mono-val" style={{ color: 'var(--text-primary)' }}>
                              {formatCurrency(b.base_amount)}
                            </span>
                          </td>
                          {isHrOrAdmin && (
                            <td className="prd-action-cell">
                              <div className="prd-action-group">
                                {/* Nút 1: Chỉnh sửa (theo LeaveRequestsPage) */}
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm btn-icon"
                                  title="Chỉnh sửa khoản thưởng"
                                  onClick={() => handleOpenEditBonus(b)}
                                >
                                  {Icons.edit}
                                </button>

                                {/* Nút 2: Tùy chọn 3 chấm (theo LeaveRequestsPage) */}
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm btn-icon"
                                  title="Tùy chọn thao tác"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setOpenMenuId(openMenuId === b.bonus_id ? null : b.bonus_id)
                                  }}
                                >
                                  {Icons.moreVertical}
                                </button>

                                {/* Dropdown Menu (chuẩn action-dropdown từ App.css như LeaveRequestsPage) */}
                                {openMenuId === b.bonus_id && (
                                  <div
                                    className="action-dropdown"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      position: 'absolute',
                                      top: '100%',
                                      right: 0,
                                      marginTop: '4px',
                                      zIndex: 80,
                                      minWidth: '180px',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="action-dropdown-item"
                                      onClick={() => {
                                        setOpenMenuId(null)
                                        handleOpenEditBonus(b)
                                      }}
                                    >
                                      <span className="action-icon">{Icons.edit}</span>
                                      <span>Chỉnh sửa khoản thưởng</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="action-dropdown-item danger"
                                      onClick={() => {
                                        setOpenMenuId(null)
                                        handleDeleteBonus(b.bonus_id, b.bonus_name)
                                      }}
                                    >
                                      <span className="action-icon">{Icons.close}</span>
                                      <span>Xóa khoản thưởng</span>
                                    </button>
                                  </div>
                                )}
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
          {/* TAB 3: QUY CHẾ TÍNH LƯƠNG & CÔNG THỨC (Tối Giản, Đầy Đủ Nội Dung) */}
          {/* ================================================================= */}
          {activeTab === 'guide' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 1. LƯƠNG CƠ BẢN & NGÀY CÔNG */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">1. Lương Cơ Bản & Ngày Công Chuẩn</h4>
                  <span className="prd-badge">CÔNG & CA</span>
                </div>

                <div className="prd-rule-formula">
                  Lương CB thực nhận = (Lương Hợp Đồng / Ngày Công Chuẩn 26) × (Công Đi Làm Thực Tế + Công Nghỉ Phép Hưởng Lương)
                </div>

                <div className="prd-rule-list">
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Ngày công chuẩn tháng:</strong> 26 ngày/tháng (áp dụng toàn bộ khối cửa hàng và văn phòng).</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Nghỉ phép hưởng lương:</strong> Nghỉ phép năm (Annual Leave) được duyệt tính đủ 1.0 ngày công.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Làm thêm giờ (OT):</strong> Giờ OT được HR phê duyệt hưởng theo tỷ lệ luật định (Ngày thường 1.5x • Cuối tuần 2.0x • Lễ Tết 3.0x).</span>
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
                    <span><strong>Nghỉ không lương:</strong> Khấu trừ trực tiếp <code>(Lương HĐ / 26) × Số ngày nghỉ</code>.</span>
                  </div>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Bảo hiểm bắt buộc (Tổng 10.5%):</strong> BHXH 8.0% • BHYT 1.5% • BHTN 1.0%.</span>
                  </div>
                </div>
              </div>

              {/* 5. QUY TRÌNH PHÊ DUYỆT 3 CẤP */}
              <div className="prd-rule-section">
                <div className="prd-rule-header">
                  <h4 className="prd-rule-title">5. Quy Trình Kiểm Soát & Quyết Toán 3 Cấp</h4>
                  <span className="prd-badge">QUY TRÌNH</span>
                </div>

                <div className="prd-steps-row">
                  <div className="prd-step-box">
                    <span className="prd-step-num">CẤP 1 • SOẠN THẢO</span>
                    <span className="prd-step-role">Kế Toán / Cửa Hàng Trưởng</span>
                    <span className="prd-step-desc">Tính toán sơ bộ từ Chấm công & POS, rà soát ngoại lệ, tạo bảng lương nháp (Draft).</span>
                  </div>

                  <div className="prd-step-box">
                    <span className="prd-step-num">CẤP 2 • THẨM ĐỊNH</span>
                    <span className="prd-step-role">Trưởng Phòng Nhân Sự</span>
                    <span className="prd-step-desc">Kiểm tra công chuẩn, phụ cấp dự án, giải trình phạt và xác nhận phê duyệt (HR Approved).</span>
                  </div>

                  <div className="prd-step-box">
                    <span className="prd-step-num">CẤP 3 • QUYẾT TOÁN</span>
                    <span className="prd-step-role">Giám Đốc Điều Hành</span>
                    <span className="prd-step-desc">Phê duyệt cấp cao cuối cùng, xuất lệnh chuyển khoản ngân hàng và khóa sổ chi trả (Paid).</span>
                  </div>
                </div>

                <div className="prd-rule-list" style={{ marginTop: '2px' }}>
                  <div className="prd-rule-item">
                    <span className="dot">•</span>
                    <span><strong>Vết kiểm toán (Audit Trail):</strong> Mọi thao tác điều chỉnh số tiền thủ công (Adjust Draft) đều bắt buộc nhập lý do giải trình và lưu vết vĩnh viễn.</span>
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
      {/* SUB-MODAL: THIẾT LẬP THƯỞNG KỲ (Tối Giản) */}
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
                <h3 className="modal-title" style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
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
              <div className="modal-body">
                {!editingBonus && (
                  <div>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Mẫu gợi ý khoản thưởng
                    </label>
                    <select
                      className="form-select"
                      value={selectedPreset}
                      onChange={(e) => handleSelectPreset(e.target.value)}
                      style={{ fontSize: '12px' }}
                    >
                      <option value="">-- Chọn mẫu điền nhanh (hoặc tự nhập) --</option>
                      <option value="TET_BONUS">TET_BONUS — Thưởng Tết Nguyên Đán (Tháng 2)</option>
                      <option value="HOLIDAY_BONUS_30_4">HOLIDAY_BONUS_30_4 — Thưởng Lễ 30/4 & 1/5 (Tháng 4)</option>
                      <option value="HOLIDAY_BONUS_2_9">HOLIDAY_BONUS_2_9 — Thưởng Lễ Quốc khánh 2/9 (Tháng 9)</option>
                      <option value="YEAR_END_BONUS">YEAR_END_BONUS — Thưởng Tháng 13 Cuối Năm (Tháng 12)</option>
                      <option value="CUSTOM">Tự viết mã & tên khoản thưởng khác...</option>
                    </select>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px' }}>Kỳ lương áp dụng *</label>
                    <input
                      type="month"
                      className="form-input"
                      value={bonusPeriod}
                      disabled={Boolean(editingBonus)}
                      onChange={(e) => setBonusPeriod(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: '12px' }}>Mã khoản thưởng *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={bonusCode}
                      disabled={Boolean(editingBonus)}
                      onChange={(e) => setBonusCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                      required
                      placeholder="VD: TET_BONUS"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '12px' }}>Tên khoản thưởng *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={bonusName}
                    onChange={(e) => setBonusName(e.target.value)}
                    required
                    placeholder="VD: Thưởng Tết Nguyên Đán 2026"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px' }}>Cách thức tính</label>
                    <select
                      className="form-select"
                      value={bonusType}
                      onChange={(e) => setBonusType(e.target.value)}
                    >
                      <option value="COEFFICIENT">Hệ số chức vụ (Mức CS × Coef)</option>
                      <option value="FIXED_AMOUNT">Tiền cố định toàn nhân viên</option>
                      <option value="CONTRACT_SALARY">Tháng 13 (Lương Hợp đồng)</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: '12px' }}>Mức tiền cơ sở (VNĐ) *</label>
                    <input
                      type="number"
                      className="form-input"
                      step="100000"
                      value={bonusAmount}
                      onChange={(e) => setBonusAmount(parseFloat(e.target.value) || 0)}
                      required
                      style={{ fontFamily: 'var(--font-mono)' }}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '2px' }}>
                  <input
                    type="checkbox"
                    id="bonusRecurringMinimal"
                    checked={bonusRecurring}
                    onChange={(e) => setBonusRecurring(e.target.checked)}
                    style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                  />
                  <label
                    htmlFor="bonusRecurringMinimal"
                    style={{ fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}
                  >
                    Lặp lại hàng năm (tự động áp dụng cho các năm kế tiếp vào cùng kỳ này)
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowBonusModal(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingBonus}
                >
                  {savingBonus ? 'Đang lưu...' : editingBonus ? 'Cập nhật' : 'Lưu khoản thưởng'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
