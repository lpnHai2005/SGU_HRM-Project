import { useState, useEffect, useMemo } from 'react'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { formatDateTime } from '../utils/formatters'
import { auditApi } from '../services/api'
import type { AuditLog } from '../types'
import './AuditLogPage.css'

interface AuditLogPageProps {
  user?: any
}

const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'badge-green',
  LOGOUT: 'badge-slate',
  CREATE: 'badge-blue',
  UPDATE: 'badge-amber',
  DELETE: 'badge-red',
  APPROVE: 'badge-green',
  REJECT: 'badge-red',
}

function getActionBadgeClass(action: string): string {
  const upperAction = String(action || '').toUpperCase()
  for (const key of Object.keys(ACTION_COLORS)) {
    if (upperAction.includes(key)) return ACTION_COLORS[key]
  }
  return 'badge-slate'
}

function safeParseJSON(val: any): any {
  if (val == null || val === undefined) return null
  if (typeof val === 'object') return val
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return val }
  }
  return val
}

function formatChanges(oldValues: any, newValues: any): { field: string; oldVal: string; newVal: string }[] {
  const changes: { field: string; oldVal: string; newVal: string }[] = []
  const oldObj = safeParseJSON(oldValues)
  const newObj = safeParseJSON(newValues)

  if (!oldObj && !newObj) return changes

  const oldKeys = (oldObj && typeof oldObj === 'object') ? Object.keys(oldObj) : []
  const newKeys = (newObj && typeof newObj === 'object') ? Object.keys(newObj) : []
  const allKeys = [...new Set([...oldKeys, ...newKeys])]

  for (const key of allKeys) {
    const oldVal = oldObj?.[key]
    const newVal = newObj?.[key]
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({
        field: key,
        oldVal: oldVal !== undefined ? (typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal)) : '-',
        newVal: newVal !== undefined ? (typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal)) : '-',
      })
    }
  }
  return changes.slice(0, 10)
}

export function AuditLogPage(_props: AuditLogPageProps) {
  const [items, setItems] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  const [jumpPage, setJumpPage] = useState('1')
  const [filters, setFilters] = useState({ action: '', entity_name: '', start_date: '', end_date: '' })
  const [availableActions, setAvailableActions] = useState<string[]>([])
  const [availableEntities, setAvailableEntities] = useState<string[]>([])
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Sync input jump page whenever page changes
  useEffect(() => {
    setJumpPage(String(page))
  }, [page])

  // Fetch filter options
  useEffect(() => {
    let active = true
    const loadFilters = async () => {
      try {
        const [actions, entities] = await Promise.all([
          auditApi.getActions(),
          auditApi.getEntities(),
        ])
        if (active) {
          setAvailableActions(Array.isArray(actions) ? actions.filter(Boolean) : [])
          setAvailableEntities(Array.isArray(entities) ? entities.filter(Boolean) : [])
        }
      } catch (e) {
        console.error('Filter load error:', e)
      }
    }
    loadFilters()
    return () => { active = false }
  }, [])

  // Fetch logs
  useEffect(() => {
    let active = true
    const loadLogs = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const params: Record<string, any> = { page, page_size: pageSize }
        if (filters.action) params.action = filters.action
        if (filters.entity_name) params.entity_name = filters.entity_name
        if (filters.start_date) params.start_date = filters.start_date
        if (filters.end_date) params.end_date = filters.end_date

        const result = await auditApi.getAll(params)

        if (!active) return

        let itemsData: AuditLog[] = []
        let totalCount = 0
        let pagesCount = 1

        if (Array.isArray(result)) {
          itemsData = result
          totalCount = result.length
          pagesCount = Math.max(1, Math.ceil(totalCount / pageSize))
        } else if (result && typeof result === 'object') {
          itemsData = Array.isArray(result.items) ? result.items : []
          totalCount = typeof result.total === 'number' ? result.total : itemsData.length
          pagesCount = Math.max(1, typeof result.total_pages === 'number'
            ? result.total_pages
            : Math.ceil(totalCount / pageSize))
        }

        setItems(itemsData)
        setTotal(totalCount)
        setTotalPages(pagesCount)
      } catch (e: any) {
        if (active) {
          console.error('Logs load error:', e)
          setError(e?.message || 'Không thể tải dữ liệu')
          setItems([])
          setTotal(0)
          setTotalPages(1)
        }
      } finally {
        if (active) setIsLoading(false)
      }
    }
    loadLogs()
    return () => { active = false }
  }, [page, pageSize, filters.action, filters.entity_name, filters.start_date, filters.end_date, refreshTrigger])

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const clearFilters = () => {
    setFilters({ action: '', entity_name: '', start_date: '', end_date: '' })
    setPage(1)
  }

  const handlePageChange = (newPage: number) => {
    const maxPage = Math.max(1, totalPages)
    const targetPage = Math.min(Math.max(1, newPage), maxPage)
    if (targetPage !== page) {
      setPage(targetPage)
      try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch {}
    }
  }

  const handleJumpSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const parsed = parseInt(jumpPage, 10)
    const maxPage = Math.max(1, totalPages)
    if (isNaN(parsed)) {
      setJumpPage(String(page))
      return
    }
    const validPage = Math.min(Math.max(1, parsed), maxPage)
    setJumpPage(String(validPage))
    if (validPage !== page) {
      handlePageChange(validPage)
    }
  }

  const selectedLogChanges = useMemo(() => {
    if (!selectedLog) return null
    const changes = formatChanges(selectedLog.old_values, selectedLog.new_values)
    if (changes.length === 0) return null
    return changes
  }, [selectedLog])

  const renderRow = (log: AuditLog, idx: number) => {
    const key = log.log_id ?? idx
    const newObj = safeParseJSON(log.new_values)
    const changeCount = (newObj && typeof newObj === 'object') ? Object.keys(newObj).length : 0
    const actionUpper = String(log.action || '').toUpperCase()

    return (
      <tr key={key}>
        <td><span className="table-cell-mono" style={{ fontSize: '0.8rem' }}>{formatDateTime(log.created_at)}</span></td>
        <td><span className="badge badge-slate">{log.username || 'System'}</span></td>
        <td><span className={`badge ${getActionBadgeClass(log.action)}`}>{log.action}</span></td>
        <td><span className="table-cell-mono">{log.entity_name}{log.entity_id != null ? ` #${log.entity_id}` : ''}</span></td>
        <td>
          {log.old_values || log.new_values ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {actionUpper.includes('CREATE') ? 'Tạo mới' : actionUpper.includes('DELETE') ? 'Xóa' : `${changeCount} thay đổi`}
            </span>
          ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
        </td>
        <td><span className="table-cell-mono" style={{ fontSize: '0.75rem' }}>{log.ip_address || '-'}</span></td>
        <td>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedLog(log)} title="Chi tiết" type="button">
            {Icons.eye}
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className="page-container audit-page">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title">Nhật ký kiểm toán</h1>
          <p className="page-subtitle">Theo dõi và truy vết hoạt động người dùng trong hệ thống</p>
        </div>

        <div className="audit-header-actions">
          {total > 0 && (
            <div className="audit-total-badge" title="Tổng số bản ghi kiểm toán trong hệ thống">
              <span className="audit-total-icon">{Icons.fileText}</span>
              <span className="audit-total-label">Tổng bản ghi:</span>
              <strong className="audit-total-number">{total.toLocaleString('vi-VN')}</strong>
            </div>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setRefreshTrigger(prev => prev + 1)}
            disabled={isLoading}
            type="button"
            title="Tải lại dữ liệu"
          >
            {isLoading ? Icons.loader : Icons.refresh} <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-body" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
              <label className="form-label">Hành động</label>
              <select className="form-select" value={filters.action} onChange={e => handleFilterChange('action', e.target.value)}>
                <option value="">Tất cả</option>
                {availableActions.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
              <label className="form-label">Đối tượng</label>
              <select className="form-select" value={filters.entity_name} onChange={e => handleFilterChange('entity_name', e.target.value)}>
                <option value="">Tất cả</option>
                {availableEntities.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: '140px' }}>
              <label className="form-label">Từ ngày</label>
              <input type="date" className="form-input" value={filters.start_date} onChange={e => handleFilterChange('start_date', e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: '140px' }}>
              <label className="form-label">Đến ngày</label>
              <input type="date" className="form-input" value={filters.end_date} onChange={e => handleFilterChange('end_date', e.target.value)} />
            </div>
            <button className="btn btn-secondary" onClick={clearFilters} type="button">Xóa lọc</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '160px' }}>Thời gian</th>
                <th style={{ width: '120px' }}>Người dùng</th>
                <th style={{ width: '120px' }}>Hành động</th>
                <th style={{ width: '150px' }}>Đối tượng</th>
                <th>Chi tiết</th>
                <th style={{ width: '120px' }}>IP</th>
                <th style={{ width: '50px' }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px' }}>Đang tải...</td></tr>
              ) : error ? (
                <tr><td colSpan={7}>
                  <EmptyState icon={Icons.alertCircle} title="Lỗi tải dữ liệu" description={error} />
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState icon={Icons.shield} title="Chưa có nhật ký" description="Hoạt động hệ thống sẽ được ghi lại tại đây." />
                </td></tr>
              ) : (
                items.map(renderRow)
              )}
            </tbody>
          </table>
        </div>

        {/* Enhanced Pagination with search / jump to page input */}
        {!isLoading && !error && (
          <div className="audit-pagination-bar">
            <div className="audit-pagination-info">
              <span>
                {total > 0 ? (
                  <>
                    Hiển thị <strong>{(page - 1) * pageSize + 1}</strong> – <strong>{Math.min(page * pageSize, total)}</strong> trong <strong>{total.toLocaleString('vi-VN')}</strong> bản ghi
                  </>
                ) : (
                  <span>Không có bản ghi nào</span>
                )}
              </span>
              <label className="audit-page-size-selector">
                <span>Dòng/trang:</span>
                <select
                  className="audit-page-size-select"
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>

            <div className="audit-pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(1)}
                disabled={page <= 1}
                type="button"
                title="Trang đầu"
                aria-label="Trang đầu"
              >
                {Icons.chevronsLeft}
              </button>
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                type="button"
                title="Trang trước"
                aria-label="Trang trước"
              >
                {Icons.chevronLeft}
              </button>

              {/* Ô ở giữa để search trang cần tới */}
              <form
                className="pagination-jump-box"
                onSubmit={handleJumpSubmit}
              >
                <span>Trang</span>
                <div className="pagination-input-wrap">
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, totalPages)}
                    value={jumpPage}
                    onChange={e => setJumpPage(e.target.value)}
                    onBlur={() => handleJumpSubmit()}
                    className="pagination-input"
                    aria-label="Nhập trang cần tới"
                    title="Nhập số trang và nhấn Enter hoặc icon kính lúp để chuyển trang"
                  />
                  <button
                    type="submit"
                    className="pagination-search-btn"
                    title="Đi tới trang"
                    aria-label="Đi tới trang"
                  >
                    {Icons.search}
                  </button>
                </div>
                <span>/ {Math.max(1, totalPages)}</span>
              </form>

              <button
                className="pagination-btn"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                type="button"
                title="Trang sau"
                aria-label="Trang sau"
              >
                {Icons.chevronRight}
              </button>
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(totalPages)}
                disabled={page >= totalPages}
                type="button"
                title="Trang cuối"
                aria-label="Trang cuối"
              >
                {Icons.chevronsRight}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Chi tiết nhật ký #{selectedLog.log_id}</h3>
              <button className="modal-close" onClick={() => setSelectedLog(null)} type="button" aria-label="Đóng">
                {Icons.x}
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Thời gian</div>
                  <div style={{ fontWeight: 500 }}>{formatDateTime(selectedLog.created_at)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Người thực hiện</div>
                  <div style={{ fontWeight: 500 }}>{selectedLog.username || 'System'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Hành động</div>
                  <span className={`badge ${getActionBadgeClass(selectedLog.action)}`}>{selectedLog.action}</span>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Đối tượng</div>
                  <div style={{ fontWeight: 500 }}>{selectedLog.entity_name}{selectedLog.entity_id != null ? ` #${selectedLog.entity_id}` : ''}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>IP</div>
                  <div style={{ fontFamily: 'monospace' }}>{selectedLog.ip_address || '-'}</div>
                </div>
              </div>

              {selectedLogChanges && selectedLogChanges.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Thay đổi dữ liệu</h4>
                  <div className="table-container">
                    <table className="audit-diff-table">
                      <thead>
                        <tr>
                          <th style={{ width: '30%' }}>Trường</th>
                          <th style={{ width: '35%' }}>Giá trị cũ</th>
                          <th style={{ width: '35%' }}>Giá trị mới</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLogChanges.map((c, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{c.field}</td>
                            <td><span className="audit-diff-del">{c.oldVal}</span></td>
                            <td><span className="audit-diff-add">{c.newVal}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(selectedLog.old_values || selectedLog.new_values) && !selectedLogChanges && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  Không có thay đổi trường chi tiết (dữ liệu thô hoặc cùng giá trị).
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border-default)' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedLog(null)} type="button">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
