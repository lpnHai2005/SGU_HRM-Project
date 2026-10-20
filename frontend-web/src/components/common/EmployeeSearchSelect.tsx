/**
 * EmployeeSearchSelect Component
 * Bộ chọn nhân viên kết hợp tìm kiếm thời gian thực (Searchable Combobox)
 * Chuẩn Vero Design System (Linear / Attio minimalist, dual theme)
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from './Icons'
import { getInitials } from '../../utils/formatters'

export interface EmployeeBadge {
  text: string
  color?: string
  backgroundColor?: string
  border?: string
}

export interface EmployeeSearchSelectProps {
  employees: any[]
  value: number | string | null | undefined
  onChange: (employeeId: number | null, employee: any | null) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  label?: string
  clearOptionLabel?: string
  getItemDisabled?: (emp: any) => boolean
  getItemBadge?: (emp: any) => EmployeeBadge | null
}

export function EmployeeSearchSelect({
  employees,
  value,
  onChange,
  placeholder = 'Tìm và chọn nhân viên...',
  disabled = false,
  required = false,
  label,
  clearOptionLabel,
  getItemDisabled,
  getItemBadge,
}: EmployeeSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [dropdownPos, setDropdownPos] = useState<React.CSSProperties>({})

  // Current selected employee object
  const selectedEmployee = useMemo(() => {
    if (!value) return null
    return employees.find((e) => String(e.employee_id) === String(value)) || null
  }, [value, employees])

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    if (!searchTerm.trim()) return employees
    const term = searchTerm.toLowerCase().trim()
    return employees.filter(
      (emp) =>
        (emp.full_name && emp.full_name.toLowerCase().includes(term)) ||
        (emp.employee_code && emp.employee_code.toLowerCase().includes(term)) ||
        (emp.department_name && emp.department_name.toLowerCase().includes(term)) ||
        (emp.position_name && emp.position_name.toLowerCase().includes(term)) ||
        (emp.store_name && emp.store_name.toLowerCase().includes(term)) ||
        (emp.phone && emp.phone.includes(term))
    )
  }, [employees, searchTerm])

  // Calculate dropdown popover position relative to viewport so it floats outside any modal
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const openUpwards = spaceBelow < 280 && spaceAbove > spaceBelow

    setDropdownPos({
      position: 'fixed',
      top: openUpwards ? undefined : `${rect.bottom + 4}px`,
      bottom: openUpwards ? `${window.innerHeight - rect.top + 4}px` : undefined,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: 99999,
    })
  }, [])

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      updatePosition()
      document.addEventListener('mousedown', handleOutsideClick)
      document.addEventListener('keydown', handleKeyDown)
      window.addEventListener('resize', updatePosition)
      window.addEventListener('scroll', updatePosition, true)
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen, updatePosition])

  const handleSelect = (emp: any) => {
    onChange(emp.employee_id, emp)
    setIsOpen(false)
    setSearchTerm('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(null, null)
    setSearchTerm('')
  }

  return (
    <div className="employee-search-select-container" ref={containerRef} style={{ position: 'relative' }}>
      {label && (
        <label
          className="form-label"
          style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}
        >
          {label} {required && <span style={{ color: 'var(--status-error)' }}>*</span>}
        </label>
      )}

      {/* Main Select Button Box */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          minHeight: '40px',
          padding: '6px 12px',
          background: 'var(--surface-input, var(--surface-card))',
          border: `1px solid ${isOpen ? 'var(--brand-primary)' : 'var(--border-default)'}`,
          borderRadius: 'var(--radius-sm)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          transition: 'all 0.15s ease',
          boxShadow: isOpen ? '0 0 0 2px var(--brand-primary-light, rgba(59, 130, 246, 0.2))' : 'none',
        }}
      >
        {selectedEmployee ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'var(--surface-subtle, rgba(59, 130, 246, 0.1))',
                color: 'var(--brand-primary)',
                border: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {getInitials(selectedEmployee.full_name)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap' }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {selectedEmployee.full_name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11.5px',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  ({selectedEmployee.employee_code})
                </span>
              </div>
              <div
                style={{
                  fontSize: '11.5px',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {selectedEmployee.department_name || 'Phòng ban'} · {selectedEmployee.position_name || 'Chức vụ'}
              </div>
            </div>
          </div>
        ) : (
          <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{placeholder}</span>
        )}

        {/* Right side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {selectedEmployee && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Xóa lựa chọn"
            >
              {Icons.x}
            </button>
          )}
          <span style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
            {Icons.chevronDown}
          </span>
        </div>
      </div>

      {/* Dropdown Popover via React Portal directly into document.body to float above modals */}
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              ...dropdownPos,
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 20px 35px -5px rgba(0, 0, 0, 0.35)',
              maxHeight: '280px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'fadeIn 0.15s ease-out',
            }}
          >
          {/* Search Input Bar */}
          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--border-default)',
              background: 'var(--surface-ground)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>{Icons.search}</span>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Gõ tên, mã nhân viên, phòng ban..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                width: '100%',
                fontSize: '12.5px',
                color: 'var(--text-primary)',
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: '2px',
                }}
              >
                {Icons.x}
              </button>
            )}
          </div>

          {/* Results List */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px' }}>
            {clearOptionLabel && !searchTerm && (
              <div
                onClick={() => {
                  onChange(null, null)
                  setIsOpen(false)
                  setSearchTerm('')
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-tertiary)',
                  fontSize: '12.5px',
                  borderBottom: '1px solid var(--border-default)',
                  marginBottom: '4px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--surface-ground)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center' }}>{Icons.x}</span>
                <span>{clearOptionLabel}</span>
              </div>
            )}
            {filteredEmployees.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12.5px' }}>
                Không tìm thấy nhân viên phù hợp
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const isSelected = selectedEmployee && String(selectedEmployee.employee_id) === String(emp.employee_id)
                const isDisabledItem = getItemDisabled ? getItemDisabled(emp) : false
                const itemBadge = getItemBadge ? getItemBadge(emp) : null

                return (
                  <div
                    key={emp.employee_id}
                    onClick={() => {
                      if (isDisabledItem) return
                      handleSelect(emp)
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: isDisabledItem ? 'not-allowed' : 'pointer',
                      opacity: isDisabledItem ? 0.55 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      background: isSelected ? 'var(--brand-primary-light, rgba(59, 130, 246, 0.12))' : 'transparent',
                      transition: 'background-color 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !isDisabledItem) e.currentTarget.style.backgroundColor = 'var(--surface-ground)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected && !isDisabledItem) e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: 'var(--surface-card)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-default)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(emp.full_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                          {emp.full_name}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            color: 'var(--text-tertiary)',
                            background: 'var(--surface-ground)',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-default)',
                          }}
                        >
                          {emp.employee_code}
                        </span>
                        {itemBadge && (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontWeight: 500,
                              color: itemBadge.color || 'var(--text-secondary)',
                              background: itemBadge.backgroundColor || 'var(--surface-ground)',
                              border: itemBadge.border || '1px solid var(--border-default)',
                            }}
                          >
                            {itemBadge.text}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {emp.department_name || 'Phòng ban'} · {emp.position_name || 'Chức vụ'}
                        {emp.store_name ? ` · ${emp.store_name}` : ''}
                      </div>
                    </div>
                    {isSelected && (
                      <span style={{ color: 'var(--brand-primary)', display: 'flex' }}>{Icons.check}</span>
                    )}
                  </div>
                )
              })
            )}
          </div>
          </div>,
          document.body
        )}
    </div>
  )
}

export default EmployeeSearchSelect
