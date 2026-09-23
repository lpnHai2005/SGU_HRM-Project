import type { ReactNode } from 'react'

export interface StatCardProps {
  icon?: ReactNode
  iconColor?: 'blue' | 'green' | 'amber' | 'red'
  label: string
  value: string | number
  trend?: string
  trendDirection?: 'up' | 'down' | 'warning'
  footerNote?: string
}

export function StatCard({
  icon,
  iconColor,
  label,
  value,
  trend,
  trendDirection = 'up',
  footerNote,
}: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <span className="stat-card-label">{label}</span>
        {icon && <div className={`stat-card-icon ${iconColor || 'blue'}`}>{icon}</div>}
      </div>
      <div className="stat-card-value">{value}</div>
      {trend && (
        <div className={`stat-card-trend-row ${trendDirection}`}>
          {trendDirection === 'warning' ? (
            <span>⚠</span>
          ) : trendDirection === 'up' ? (
            <span>↗</span>
          ) : (
            <span>↘</span>
          )}
          <span>{trend}</span>
        </div>
      )}
      {footerNote && <div className="stat-card-footer-note">{footerNote}</div>}
    </div>
  )
}
