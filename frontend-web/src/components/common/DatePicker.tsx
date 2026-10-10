import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './DatePicker.css'

const localDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

export function DatePicker({ value, onChange, label, disabled = false, error }: {
  value: string
  onChange: (value: string) => void
  label: string
  disabled?: boolean
  error?: string
}) {
  const pickerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const selected = new Date(`${value}T00:00:00`)
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 })
  const monthLabel = `${visibleMonth.toLocaleDateString('vi-VN', { month: 'long' })} ${visibleMonth.getFullYear()}`
  const monthDays = useMemo(() => {
    const firstOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7
    const gridStart = new Date(firstOfMonth)
    gridStart.setDate(firstOfMonth.getDate() - mondayOffset)
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart)
      day.setDate(gridStart.getDate() + index)
      return day
    })
  }, [visibleMonth])

  useEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const input = pickerRef.current?.querySelector('input')
      if (!input) return
      const rect = input.getBoundingClientRect()
      const popoverHeight = 330
      setPopoverPosition({
        top: window.innerHeight - rect.bottom < popoverHeight ? Math.max(8, rect.top - popoverHeight - 6) : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
      })
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node
        && !pickerRef.current?.contains(event.target)
        && !popoverRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    updatePosition()
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  const showPicker = () => {
    if (disabled) return
    setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1))
    setOpen(current => !current)
  }

  const changeMonth = (offset: number) => {
    setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  return (
    <div className="form-group work-date-field" ref={pickerRef}>
      <label className="form-label" htmlFor={inputId}>{label}</label>
      <div className="work-date-input-wrap">
        <input
          id={inputId}
          className="form-input"
          type="text"
          value={formatDate(value)}
          placeholder="DD/MM/YYYY"
          readOnly
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onClick={showPicker}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              showPicker()
            }
          }}
        />
        <button type="button" className="work-date-trigger" aria-label={`Chọn ${label.toLowerCase()}`} onClick={showPicker} disabled={disabled}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>
      {open && createPortal(
        <div ref={popoverRef} className="work-date-popover" style={popoverPosition} role="dialog" aria-label={`Chọn ${label.toLowerCase()}`}>
          <div className="work-date-calendar-header">
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Tháng trước" onClick={() => changeMonth(-1)}>‹</button>
            <strong>{monthLabel}</strong>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Tháng sau" onClick={() => changeMonth(1)}>›</button>
          </div>
          <div className="work-date-calendar-grid" role="grid">
            {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((weekday, index) => (
              <span key={weekday} className="work-date-weekday" role="columnheader" aria-label={['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'][index]}>{weekday}</span>
            ))}
            {monthDays.map(day => {
              const dayValue = localDate(day)
              const isSelected = dayValue === value
              const isCurrentMonth = day.getMonth() === visibleMonth.getMonth()
              return (
                <button
                  type="button"
                  key={dayValue}
                  role="gridcell"
                  aria-pressed={isSelected}
                  aria-label={day.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  className={`work-date-day ${isSelected ? 'selected' : ''} ${isCurrentMonth ? '' : 'outside-month'}`}
                  onClick={() => {
                    onChange(dayValue)
                    setOpen(false)
                  }}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>
          <button type="button" className="work-date-today" onClick={() => { onChange(localDate(new Date())); setOpen(false) }}>Hôm nay</button>
        </div>,
        document.body,
      )}
      {error && <small id={`${inputId}-error`} className="work-date-error" role="alert">{error}</small>}
    </div>
  )
}
