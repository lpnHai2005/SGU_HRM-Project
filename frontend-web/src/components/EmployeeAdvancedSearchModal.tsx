import React, { useState, useEffect } from 'react'
import { Icons } from './common/Icons'
import './EmployeeAdvancedSearchModal.css'

export type SearchFieldType = 'text' | 'province' | 'number' | 'date'

export interface SearchField {
  key: string
  label: string
  type: SearchFieldType
  group: string
  placeholder: string
  sensitive?: boolean
}

export const SEARCH_FIELDS: SearchField[] = [
  { key: 'name', label: 'Họ và tên', type: 'text', group: 'Thông tin cá nhân', placeholder: 'VD: Nguyen Van An' },
  { key: 'code', label: 'Mã nhân viên', type: 'text', group: 'Thông tin cá nhân', placeholder: 'VD: TZ-001' },
  { key: 'age', label: 'Tuổi', type: 'number', group: 'Thông tin cá nhân', placeholder: 'VD: 30' },
  { key: 'phone', label: 'Số điện thoại', type: 'text', group: 'Thông tin cá nhân', placeholder: 'VD: 0901' },
  { key: 'email', label: 'Email cá nhân / công ty', type: 'text', group: 'Thông tin cá nhân', placeholder: 'VD: gmail.com' },
  { key: 'identity_card', label: 'Số CCCD', type: 'text', group: 'Thông tin cá nhân', placeholder: 'VD: 079' },
  { key: 'current_province', label: 'Tỉnh/Thành phố đang ở', type: 'province', group: 'Địa chỉ', placeholder: '' },
  { key: 'current_ward', label: 'Phường/Xã đang ở', type: 'text', group: 'Địa chỉ', placeholder: 'VD: phuong sai gon' },
  { key: 'permanent_province', label: 'Tỉnh/Thành phố thường trú', type: 'province', group: 'Địa chỉ', placeholder: '' },
  { key: 'permanent_ward', label: 'Phường/Xã thường trú', type: 'text', group: 'Địa chỉ', placeholder: 'VD: phuong xuan hoa' },
  { key: 'address', label: 'Số nhà, tên đường (cả 2 địa chỉ)', type: 'text', group: 'Địa chỉ', placeholder: 'VD: le thanh ton' },
  { key: 'department', label: 'Phòng ban', type: 'text', group: 'Công việc & Lương', placeholder: 'VD: kinh doanh' },
  { key: 'join_date', label: 'Ngày vào làm', type: 'date', group: 'Công việc & Lương', placeholder: '' },
  { key: 'base_salary', label: 'Lương cơ bản (HĐ hiện tại)', type: 'number', group: 'Công việc & Lương', placeholder: 'VD: 15000000' },
  { key: 'bank_name', label: 'Tên ngân hàng', type: 'text', group: 'Tài chính', placeholder: 'VD: vietcombank' },
  { key: 'tax_code', label: 'Mã số thuế cá nhân', type: 'text', group: 'Tài chính', placeholder: 'VD: 83', sensitive: true },
  { key: 'insurance_code', label: 'Mã số BHXH', type: 'text', group: 'Tài chính', placeholder: 'VD: 79', sensitive: true },
  { key: 'bank_account', label: 'Số tài khoản ngân hàng', type: 'text', group: 'Tài chính', placeholder: 'VD: 0071', sensitive: true },
]

export const SEARCH_FIELD_GROUPS = ['Thông tin cá nhân', 'Địa chỉ', 'Công việc & Lương', 'Tài chính']

export interface SearchOperatorDef {
  key: string
  backendOp: string
  not: boolean
  label: string
}

export const SEARCH_OPS_BY_TYPE: Record<SearchFieldType, SearchOperatorDef[]> = {
  text: [
    { key: 'contains', backendOp: 'contains', not: false, label: 'Có chứa' },
    { key: 'not_contains', backendOp: 'contains', not: true, label: 'Không chứa' },
    { key: 'starts', backendOp: 'starts', not: false, label: 'Bắt đầu bằng' },
    { key: 'eq', backendOp: 'eq', not: false, label: 'Đúng bằng (=)' },
    { key: 'neq', backendOp: 'neq', not: false, label: 'Khác (≠)' },
  ],
  province: [
    { key: 'in', backendOp: 'in', not: false, label: 'Thuộc một trong các tỉnh' },
    { key: 'not_in', backendOp: 'in', not: true, label: 'Không thuộc các tỉnh này' },
    { key: 'eq', backendOp: 'eq', not: false, label: 'Chính xác là (=)' },
    { key: 'neq', backendOp: 'neq', not: false, label: 'Không phải là (≠)' },
  ],
  number: [
    { key: 'eq', backendOp: 'eq', not: false, label: 'Bằng (=)' },
    { key: 'neq', backendOp: 'neq', not: false, label: 'Khác (≠)' },
    { key: 'gte', backendOp: 'gte', not: false, label: 'Từ mức (≥)' },
    { key: 'gt', backendOp: 'gt', not: false, label: 'Lớn hơn (>)' },
    { key: 'lte', backendOp: 'lte', not: false, label: 'Tối đa (≤)' },
    { key: 'lt', backendOp: 'lt', not: false, label: 'Nhỏ hơn (<)' },
    { key: 'between', backendOp: 'between', not: false, label: 'Trong khoảng' },
  ],
  date: [
    { key: 'eq', backendOp: 'eq', not: false, label: 'Đúng ngày (=)' },
    { key: 'neq', backendOp: 'neq', not: false, label: 'Khác ngày (≠)' },
    { key: 'gte', backendOp: 'gte', not: false, label: 'Từ ngày (≥)' },
    { key: 'gt', backendOp: 'gt', not: false, label: 'Sau ngày (>)' },
    { key: 'lte', backendOp: 'lte', not: false, label: 'Đến ngày (≤)' },
    { key: 'lt', backendOp: 'lt', not: false, label: 'Trước ngày (<)' },
    { key: 'between', backendOp: 'between', not: false, label: 'Trong khoảng' },
  ],
}

export type SearchCondition = {
  join: 'AND' | 'OR'
  not: boolean
  field: string
  op: string
  value: string
  value2: string
  values: string[]
}

export type Province = {
  name: string
  code: number
  wards: { name: string; code: number }[]
}

export interface EmployeeAdvancedSearchModalProps {
  isOpen: boolean
  onClose: () => void
  onApply: (conditions: SearchCondition[], matchMode: 'AND' | 'OR') => void
  onClear: () => void
  initialConditions: SearchCondition[]
  initialMatchMode: 'AND' | 'OR'
  provinces: Province[]
  canManage: boolean
}

export const newCondition = (join: 'AND' | 'OR' = 'AND'): SearchCondition => ({
  join,
  not: false,
  field: 'name',
  op: 'contains',
  value: '',
  value2: '',
  values: [],
})

export const hasConditionValue = (cond: SearchCondition) =>
  cond.op === 'in' ? cond.values.length > 0 : Boolean(cond.value.trim() || cond.value2.trim())

export const getOpDef = (type: SearchFieldType, op: string, not: boolean): SearchOperatorDef => {
  const ops = SEARCH_OPS_BY_TYPE[type] || SEARCH_OPS_BY_TYPE.text
  return ops.find(o => o.backendOp === op && o.not === not) || ops[0]
}

export const formatConditionDisplayValue = (field: SearchField | undefined, value: string) => {
  if (!value) return ''
  if (field?.key === 'base_salary') {
    const num = Number(value)
    return isNaN(num) ? value : `${num.toLocaleString('vi-VN')} ₫`
  }
  if (field?.type === 'date') return value.split('-').reverse().join('/')
  if (field?.type === 'number') return `${value} tuổi`
  return `"${value}"`
}

export const describeConditionsInNaturalLanguage = (
  conditions: SearchCondition[],
  mode: 'AND' | 'OR' = 'AND'
) => {
  const validConds = conditions.filter(hasConditionValue)
  if (validConds.length === 0) return ''

  return validConds
    .map(cond => {
      const field = SEARCH_FIELDS.find(item => item.key === cond.field)
      const type = field?.type || 'text'
      const opDef = getOpDef(type, cond.op, cond.not)
      let valStr = ''
      if (cond.op === 'in') {
        valStr = cond.values.map(v => `"${v}"`).join(', ')
      } else if (cond.op === 'between') {
        valStr = `từ ${formatConditionDisplayValue(field, cond.value)} đến ${formatConditionDisplayValue(field, cond.value2)}`
      } else {
        valStr = formatConditionDisplayValue(field, cond.value)
      }
      return `${field?.label} ${opDef.label.toLowerCase()} ${valStr}`
    })
    .join(mode === 'AND' ? ' VÀ ' : ' HOẶC ')
}

export const EmployeeAdvancedSearchModal: React.FC<EmployeeAdvancedSearchModalProps> = ({
  isOpen,
  onClose,
  onApply,
  onClear,
  initialConditions,
  initialMatchMode,
  provinces,
  canManage,
}) => {
  const [matchMode, setMatchMode] = useState<'AND' | 'OR'>(initialMatchMode)
  const [conditions, setConditions] = useState<SearchCondition[]>([newCondition(initialMatchMode)])
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (isOpen) {
      setMatchMode(initialMatchMode)
      if (initialConditions.length > 0) {
        setConditions(initialConditions.map(c => ({ ...c, join: initialMatchMode })))
      } else {
        setConditions([newCondition(initialMatchMode)])
      }
      setError('')
    }
  }, [isOpen, initialConditions, initialMatchMode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const updateCondition = (index: number, patch: Partial<SearchCondition>) => {
    setConditions(prev =>
      prev.map((cond, i) => {
        if (i !== index) return cond
        const next = { ...cond, ...patch }
        // Khi đổi trường sang kiểu dữ liệu khác
        if (patch.field && patch.field !== cond.field) {
          const oldType = SEARCH_FIELDS.find(f => f.key === cond.field)?.type || 'text'
          const newType = SEARCH_FIELDS.find(f => f.key === patch.field)?.type || 'text'
          if (oldType !== newType) {
            const defaultOpDef = SEARCH_OPS_BY_TYPE[newType][0]
            next.op = defaultOpDef.backendOp
            next.not = defaultOpDef.not
            next.value = ''
            next.value2 = ''
            next.values = []
          }
        }
        return next
      })
    )
  }

  const handleOpChange = (index: number, type: SearchFieldType, opKey: string) => {
    const opDef = SEARCH_OPS_BY_TYPE[type].find(o => o.key === opKey)
    if (opDef) {
      updateCondition(index, {
        op: opDef.backendOp,
        not: opDef.not,
        ...(opDef.backendOp === 'in' ? { value: '', value2: '' } : { values: [] }),
      })
    }
  }

  const handleAddCondition = () => {
    if (conditions.length >= 10) return
    setConditions(prev => [...prev, newCondition(matchMode)])
  }

  const handleRemoveCondition = (index: number) => {
    if (conditions.length <= 1) return
    setConditions(prev => prev.filter((_, i) => i !== index))
  }

  const handleReset = () => {
    setConditions([newCondition('AND')])
    setMatchMode('AND')
    setError('')
    onClear()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validConds = conditions.filter(hasConditionValue)
    if (validConds.length === 0) {
      setError('Vui lòng nhập ít nhất một giá trị tìm kiếm.')
      return
    }

    const incompleteIndex = conditions.findIndex(
      cond =>
        cond.op !== 'in' &&
        (!cond.value.trim() || (cond.op === 'between' && !cond.value2.trim())) &&
        (cond.value.trim() || cond.value2.trim())
    )

    if (incompleteIndex >= 0) {
      setError(`Điều kiện số ${incompleteIndex + 1} chưa nhập đầy đủ giá trị.`)
      return
    }

    setError('')
    const finalized = validConds.map(cond => ({
      ...cond,
      join: matchMode,
    }))
    onApply(finalized, matchMode)
    onClose()
  }

  const validConditions = conditions.filter(hasConditionValue)

  return (
    <div
      className="modal-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="advanced-search-modal-title"
    >
      <div className="modal advanced-search-modal-wrap">
        {/* Header chuẩn Vero Design System */}
        <div className="modal-header">
          <h3
            id="advanced-search-modal-title"
            className="modal-title"
            style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
          >
            <span className="modal-title-icon icon-view">
              {Icons.search}
            </span>
            <span>Tìm kiếm nhân sự nâng cao</span>
          </h3>
          <button type="button" className="modal-close" onClick={onClose} title="Đóng (Esc)">
            {Icons.x}
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="modal-body">
            {/* Thanh chọn chế độ so khớp (Segmented Toggle chuẩn Vero) */}
            <div className="search-match-mode-bar">
              <div className="search-match-mode-label">
                <strong>Chế độ kết hợp điều kiện:</strong>
                <small>
                  {matchMode === 'AND'
                    ? 'Nhân sự phải thỏa mãn đồng thời tất cả các điều kiện bên dưới.'
                    : 'Nhân sự chỉ cần thỏa mãn một trong các điều kiện bên dưới.'}
                </small>
              </div>
              <div className="search-segmented-toggle" role="group" aria-label="Chế độ kết hợp điều kiện">
                <button
                  type="button"
                  className={`search-segmented-btn ${matchMode === 'AND' ? 'active' : ''}`}
                  onClick={() => setMatchMode('AND')}
                >
                  Thỏa TẤT CẢ (VÀ)
                </button>
                <button
                  type="button"
                  className={`search-segmented-btn ${matchMode === 'OR' ? 'active' : ''}`}
                  onClick={() => setMatchMode('OR')}
                >
                  Thỏa BẤT KỲ (HOẶC)
                </button>
              </div>
            </div>

            {/* Danh sách các dòng điều kiện */}
            <div className="search-conditions-list">
              {conditions.map((cond, index) => {
                const field = SEARCH_FIELDS.find(f => f.key === cond.field) || SEARCH_FIELDS[0]
                const type = field.type
                const currentOpDef = getOpDef(type, cond.op, cond.not)

                return (
                  <React.Fragment key={index}>
                    {index > 0 && (
                      <div className="condition-connector-line">
                        <span className="condition-connector-pill">
                          {matchMode === 'AND' ? 'VÀ' : 'HOẶC'}
                        </span>
                      </div>
                    )}

                    <div className="condition-card">
                      <div className="condition-card-row">
                        <span className="condition-index-badge">#{index + 1}</span>

                        {/* Chọn trường dữ liệu */}
                        <div className="condition-field-select">
                          <select
                            className="form-select"
                            value={cond.field}
                            aria-label={`Điều kiện ${index + 1} - Chọn trường thông tin`}
                            onChange={e => updateCondition(index, { field: e.target.value })}
                          >
                            {SEARCH_FIELD_GROUPS.map(group => {
                              const groupFields = SEARCH_FIELDS.filter(
                                f => f.group === group && (canManage || !f.sensitive)
                              )
                              if (groupFields.length === 0) return null
                              return (
                                <optgroup key={group} label={group}>
                                  {groupFields.map(f => (
                                    <option key={f.key} value={f.key}>
                                      {f.label} {f.sensitive ? '🔒' : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              )
                            })}
                          </select>
                        </div>

                        {/* Chọn toán tử / phép so sánh */}
                        <div className="condition-op-select">
                          <select
                            className="form-select"
                            value={currentOpDef.key}
                            aria-label={`Điều kiện ${index + 1} - Phép so sánh`}
                            onChange={e => handleOpChange(index, type, e.target.value)}
                          >
                            {SEARCH_OPS_BY_TYPE[type].map(op => (
                              <option key={op.key} value={op.key}>
                                {op.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Ô nhập giá trị */}
                        <div className="condition-value-cell">
                          {type === 'province' && cond.op === 'in' ? (
                            <div className="multi-province-input-wrap">
                              <select
                                className="form-select"
                                value=""
                                aria-label={`Thêm tỉnh/thành phố cho điều kiện ${index + 1}`}
                                onChange={e => {
                                  if (e.target.value && !cond.values.includes(e.target.value)) {
                                    updateCondition(index, { values: [...cond.values, e.target.value] })
                                  }
                                }}
                              >
                                <option value="">+ Chọn tỉnh/thành phố…</option>
                                {provinces
                                  .filter(item => !cond.values.includes(item.name))
                                  .map(item => (
                                    <option key={item.code} value={item.name}>
                                      {item.name}
                                    </option>
                                  ))}
                              </select>

                              {/* Gợi ý chọn nhanh */}
                              <div className="multi-province-quick-chips">
                                <span className="quick-chip-label">Gợi ý nhanh:</span>
                                {['Thành phố Hà Nội', 'Thành phố Hồ Chí Minh', 'Thành phố Đà Nẵng'].map(quickCity => {
                                  const isSelected = cond.values.includes(quickCity)
                                  if (isSelected) return null
                                  return (
                                    <button
                                      key={quickCity}
                                      type="button"
                                      className="quick-chip-btn"
                                      onClick={() => updateCondition(index, { values: [...cond.values, quickCity] })}
                                    >
                                      + {quickCity.replace('Thành phố ', '')}
                                    </button>
                                  )
                                })}
                              </div>

                              {/* Danh sách thẻ tỉnh đã chọn */}
                              {cond.values.length > 0 && (
                                <div className="multi-province-tags">
                                  {cond.values.map(name => (
                                    <span key={name} className="province-tag-chip">
                                      <span>{name}</span>
                                      <button
                                        type="button"
                                        aria-label={`Bỏ chọn ${name}`}
                                        onClick={() =>
                                          updateCondition(index, {
                                            values: cond.values.filter(v => v !== name),
                                          })
                                        }
                                      >
                                        {Icons.close}
                                      </button>
                                    </span>
                                  ))}
                                  {cond.values.length >= 2 && (
                                    <button
                                      type="button"
                                      style={{
                                        fontSize: '11px',
                                        color: 'var(--text-muted)',
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                        padding: '2px 4px',
                                        fontFamily: 'var(--font-sans)',
                                      }}
                                      onClick={() => updateCondition(index, { values: [] })}
                                    >
                                      Xóa tất cả
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : type === 'province' ? (
                            <select
                              className="form-select"
                              value={cond.value}
                              aria-label={`Điều kiện ${index + 1} - Chọn tỉnh/thành phố`}
                              onChange={e => updateCondition(index, { value: e.target.value })}
                            >
                              <option value="">-- Chọn Tỉnh/Thành phố --</option>
                              {provinces.map(p => (
                                <option key={p.code} value={p.name}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          ) : cond.op === 'between' ? (
                            <div className="between-inputs-wrap">
                              <input
                                type={type === 'number' ? 'number' : 'date'}
                                className="form-input"
                                placeholder={type === 'number' ? 'Từ giá trị' : 'Từ ngày'}
                                value={cond.value}
                                aria-label={`Điều kiện ${index + 1} - Từ`}
                                onChange={e => updateCondition(index, { value: e.target.value })}
                              />
                              <span className="between-separator">đến</span>
                              <input
                                type={type === 'number' ? 'number' : 'date'}
                                className="form-input"
                                placeholder={type === 'number' ? 'Đến giá trị' : 'Đến ngày'}
                                value={cond.value2}
                                aria-label={`Điều kiện ${index + 1} - Đến`}
                                onChange={e => updateCondition(index, { value2: e.target.value })}
                              />
                            </div>
                          ) : (
                            <input
                              type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                              className="form-input"
                              placeholder={field.placeholder || 'Nhập từ khóa tìm kiếm...'}
                              min={type === 'number' ? 0 : undefined}
                              value={cond.value}
                              aria-label={`Điều kiện ${index + 1} - Giá trị tìm kiếm`}
                              onChange={e => updateCondition(index, { value: e.target.value })}
                            />
                          )}
                        </div>

                        {/* Nút xóa điều kiện */}
                        <div className="condition-actions-cell">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            title="Xóa điều kiện này"
                            aria-label={`Xóa điều kiện ${index + 1}`}
                            disabled={conditions.length === 1}
                            onClick={() => handleRemoveCondition(index)}
                            style={{ height: '34px', width: '34px', padding: 0 }}
                          >
                            {Icons.close}
                          </button>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
            </div>

            {/* Nút thêm điều kiện */}
            <div className="add-condition-btn-wrap">
              <button
                type="button"
                className="btn-add-condition"
                disabled={conditions.length >= 10}
                onClick={handleAddCondition}
              >
                {Icons.plus}
                <span>Thêm tiêu chí lọc</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  ({conditions.length}/10)
                </span>
              </button>
            </div>

            {/* Bản xem trước ngôn ngữ tự nhiên */}
            {validConditions.length > 0 && (
              <div className="search-preview-card">
                <div className="search-preview-header">
                  {Icons.sparkles}
                  <span>Xem trước kết quả tìm kiếm</span>
                </div>
                <div className="search-preview-content">
                  Tìm nhân sự thỏa mãn{' '}
                  <span className="preview-match-highlight">
                    {matchMode === 'AND' ? 'TẤT CẢ' : 'BẤT KỲ'}
                  </span>{' '}
                  các tiêu chí:
                  {validConditions.map((cond, i) => {
                    const field = SEARCH_FIELDS.find(item => item.key === cond.field)
                    const type = field?.type || 'text'
                    const opDef = getOpDef(type, cond.op, cond.not)
                    let valStr = ''
                    if (cond.op === 'in') {
                      valStr = cond.values.length > 0 ? cond.values.map(v => `"${v}"`).join(', ') : '(chưa chọn)'
                    } else if (cond.op === 'between') {
                      valStr = `từ ${formatConditionDisplayValue(field, cond.value)} đến ${formatConditionDisplayValue(field, cond.value2)}`
                    } else {
                      valStr = formatConditionDisplayValue(field, cond.value)
                    }
                    return (
                      <span key={i} className="preview-item">
                        <strong>{field?.label}</strong> <em>{opDef.label.toLowerCase()}</em>{' '}
                        <span className="preview-item-value">{valStr}</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: '14px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--status-error-bg)',
                  border: '1px solid var(--status-error-border)',
                  color: 'var(--status-error)',
                  fontSize: '12.5px',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div className="modal-footer search-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleReset}>
              {Icons.undo}
              <span>Đặt lại</span>
            </button>

            <div className="search-modal-footer-right">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Hủy bỏ
              </button>
              <button type="submit" className="btn btn-primary">
                {Icons.search}
                <span>Áp dụng</span>
                {validConditions.length > 0 && (
                  <span className="search-count-badge">
                    {validConditions.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
