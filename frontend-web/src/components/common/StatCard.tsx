import type { ReactNode } from 'react'

export interface StatCardProps {
  icon?: ReactNode
  iconColor?: 'blue' | 'green' | 'amber' | 'red'
  label: string
  value: string | number
  trend?: ReactNode
  trendDirection?: 'up' | 'down' | 'warning'
  footerNote?: ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
}

export function StatCard({
  icon,
  iconColor,
  label,
  value,
  trend,
  trendDirection = 'up',
  footerNote,
  onClick,
  active,
  className,
}: StatCardProps) {
  // Tự động bọc status-pill cho các text trạng thái thông dụng nếu truyền text trơn
  const renderTrend = () => {
    if (!trend) return null
    if (typeof trend === 'string') {
      if (['Tốt', 'Đúng giờ', 'Không phạt'].includes(trend.trim())) {
        return <span className="status-pill active">{trend}</span>
      }
      if (['Có vi phạm', 'Vi phạm', 'Trễ'].includes(trend.trim())) {
        return <span className="status-pill error">{trend}</span>
      }
      if (['Có về sớm', 'Cảnh báo'].includes(trend.trim())) {
        return <span className="status-pill warning">{trend}</span>
      }
    }
    return trend
  }

  return (
    <div
      className={`stat-card kpi-card ${className || ''}${active ? ' is-active' : ''}${onClick ? ' is-clickable' : ''}`.trim()}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="stat-card-header">
        <span className="stat-card-label">{label}</span>
        {icon && <div className={`stat-card-icon ${iconColor || 'blue'}`}>{icon}</div>}
      </div>
      <div className="stat-card-value">{value}</div>
      {trend && (
        <div className={`stat-card-trend-row ${trendDirection}`}>
          {typeof trend === 'string' && (
            trendDirection === 'warning' ? (
              <span>⚠</span>
            ) : trendDirection === 'up' ? (
              <span>↗</span>
            ) : (
              <span>↘</span>
            )
          )}
          {renderTrend()}
        </div>
      )}
      {footerNote && <div className="stat-card-footer-note">{footerNote}</div>}
    </div>
  )
}
