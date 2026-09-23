import { useState, useEffect } from 'react'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { formatDate } from '../utils/formatters'

export interface AuditLogPageProps {
  user: any
}

export function AuditLogPage({ user: _user }: AuditLogPageProps) {
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchAuditLogs = async () => {
      setIsLoading(true)
      try {
        const { auditApi } = await import('../services/api')
        const data = await auditApi.getAll({ limit: 50 })
        setAuditLogs(data || [])
      } catch (err) {
        console.error('Error fetching audit logs:', err)
        setAuditLogs([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchAuditLogs()
  }, [])

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
            Đang tải dữ liệu...
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Người dùng</th>
                  <th>Hành động</th>
                  <th>Đối tượng</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log, index) => (
                  <tr key={index}>
                    <td><span className="table-cell-mono">{formatDate(log.created_at)}</span></td>
                    <td><span className="badge badge-slate">{log.username || 'System'}</span></td>
                    <td>{log.action}</td>
                    <td><span className="table-cell-mono">{log.entity_name} #{log.entity_id}</span></td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState
                        icon={Icons.shield}
                        title="Chưa có nhật ký"
                        description="Hoạt động hệ thống sẽ được ghi lại tại đây."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
