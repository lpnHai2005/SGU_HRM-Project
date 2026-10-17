import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { Icons } from './common/Icons'
import { StoreMapPicker } from './StoreMapPicker'

export type StoreDetailRecord = {
  store_id?: number
  store_code: string
  store_name: string
  address: string
  district: string
  city: string
  open_date: string
  created_at?: string | null
  updated_at?: string | null
  manager_employee_id?: number | null
  manager_name?: string | null
  manager_code?: string | null
  is_active: boolean
  latitude: number | string
  longitude: number | string
  radius_meters: number | string
  wifi_networks: string[]
}

type AuditEntry = {
  log_id: number
  user_id?: number | null
  username?: string | null
  action: string
  entity_id?: string | null
  old_values?: Record<string, unknown> | null
  new_values?: Record<string, unknown> | null
  created_at: string
}

const fieldNames: Record<string, string> = {
  store_code: 'Mã cửa hàng', store_name: 'Tên cửa hàng', address: 'Địa chỉ', district: 'Phường/xã',
  city: 'Tỉnh/thành', manager_employee_id: 'Người phụ trách', latitude: 'Vĩ độ',
  longitude: 'Kinh độ', radius_meters: 'Bán kính GPS', wifi_networks: 'Dải IP', is_active: 'Trạng thái',
}
const formatDate = (value?: string | null) => value && !Number.isNaN(Date.parse(value))
  ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
const formatCoordinate = (value: number | string) => Number(value).toFixed(6)
const validGeo = (store: StoreDetailRecord) => {
  const lat = Number(store.latitude), lon = Number(store.longitude)
  return String(store.latitude).trim() !== '' && String(store.longitude).trim() !== ''
    && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90
    && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0)
}
const auditValue = (value: unknown) => value === null || value === undefined || value === '' ? '—'
  : Array.isArray(value) ? value.join(', ') || '—' : typeof value === 'boolean' ? (value ? 'Có' : 'Không') : String(value)
const changedFields = (entry: AuditEntry) => {
  const before = entry.old_values || {}
  const after = entry.new_values || {}
  return Object.keys(after).filter(key => key in fieldNames && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ key, label: fieldNames[key], before: auditValue(before[key]), after: auditValue(after[key]) }))
}

export function StoreDetailDrawer({ store, onClose, onEdit }: {
  store: StoreDetailRecord
  onClose: () => void
  onEdit: (store: StoreDetailRecord) => void
}) {
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState('')

  useEffect(() => {
    let current = true
    api.get<AuditEntry[]>('/audit-logs', { limit: 200, entity_name: 'stores' })
      .then(rows => { if (current) setAudit(rows.filter(row => row.entity_id === String(store.store_id)).slice(0, 5)) })
      .catch(() => { if (current) setAuditError('Chưa tải được lịch sử thay đổi.') })
      .finally(() => { if (current) setAuditLoading(false) })
    return () => { current = false }
  }, [store.store_id])

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])

  const gpsReady = validGeo(store)
  const networks = store.wifi_networks || []
  return <div className="store-detail-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="store-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="store-detail-title">
      <header className="store-detail-header">
        <div><span className="store-detail-eyebrow">CHI TIẾT CHI NHÁNH</span><h2 id="store-detail-title">{store.store_name}</h2><p>{store.store_code}</p></div>
        <button type="button" className="modal-close" aria-label="Đóng chi tiết" onClick={onClose}>{Icons.x}</button>
      </header>
      <div className="store-detail-body">
        <div className="store-detail-status"><span className={`store-state ${store.is_active ? 'active' : 'inactive'}`}>{store.is_active ? 'Đang hoạt động' : 'Tạm dừng'}</span><span>{store.city}</span></div>
        <section className="store-detail-section"><h3>Thông tin cơ bản</h3><dl>
          <div><dt>Mã cửa hàng</dt><dd>{store.store_code}</dd></div>
          <div><dt>Địa chỉ hành chính</dt><dd>{[store.address, store.district, store.city].filter(Boolean).join(', ') || 'Chưa có địa chỉ'}</dd></div>
          <div><dt>Ngày mở cửa</dt><dd>{store.open_date ? new Date(`${store.open_date}T12:00:00`).toLocaleDateString('vi-VN') : '—'}</dd></div>
          {store.created_at && <div><dt>Ngày tạo</dt><dd>{formatDate(store.created_at)}</dd></div>}
          {store.updated_at && <div><dt>Cập nhật</dt><dd>{formatDate(store.updated_at)}</dd></div>}
        </dl></section>
        <section className="store-detail-section"><h3>Vị trí & GPS</h3>
          {gpsReady ? <><div className="store-detail-map"><StoreMapPicker latitude={Number(store.latitude)} longitude={Number(store.longitude)} radius={Number(store.radius_meters)} bounds={null} onChange={() => {}} readOnly /></div><dl>
            <div><dt>Vĩ độ</dt><dd>{formatCoordinate(store.latitude)}</dd></div>
            <div><dt>Kinh độ</dt><dd>{formatCoordinate(store.longitude)}</dd></div>
            <div><dt>Bán kính</dt><dd>{store.radius_meters} m</dd></div>
          </dl></> : <p className="store-detail-muted">Chưa có tọa độ GPS hợp lệ.</p>}
        </section>
        <section className="store-detail-section"><h3>IP chấm công web</h3>
          <p className="store-detail-muted">{networks.length ? `${networks.length} dải IP được phép` : 'Không giới hạn IP — danh sách CIDR đang trống'}</p>
          {networks.length > 0 && <ul className="store-network-list">{networks.map(network => <li key={network}>{network}</li>)}</ul>}
          <small>Chính sách IP áp dụng cho chấm công trên website; ứng dụng mobile dùng GPS/geofence.</small>
        </section>
        <section className="store-detail-section"><h3>Nhân sự phụ trách</h3><dl>
          <div><dt>Cửa hàng trưởng</dt><dd>{store.manager_name || 'Chưa phân công'}</dd></div>
          {store.manager_employee_id && <div><dt>Mã nhân viên</dt><dd>{store.manager_code || `#${store.manager_employee_id}`}</dd></div>}
        </dl>{store.store_id && <Link className="store-detail-link" to={`/employees?store_id=${store.store_id}`}>Xem nhân viên cửa hàng {Icons.chevronRight}</Link>}</section>
        <section className="store-detail-section"><h3>Lịch sử thay đổi gần đây</h3>
          {auditLoading ? <p className="store-detail-muted">Đang tải lịch sử…</p> : auditError ? <p className="store-error" role="alert">{auditError}</p> : audit.length ? <ol className="store-audit-list">{audit.map(entry => <li key={entry.log_id}><strong>{entry.action === 'TRANSFER_STORE_MANAGER' ? 'Chuyển người phụ trách' : 'Cấu hình cửa hàng'}</strong><small>{formatDate(entry.created_at)} · {entry.username || (entry.user_id ? `User #${entry.user_id}` : 'Hệ thống')}</small>{changedFields(entry).length > 0 && <details className="store-audit-changes"><summary>Thay đổi: {changedFields(entry).map(change => change.label).join(', ')}</summary><dl>{changedFields(entry).map(change => <div key={change.key}><dt>{change.label}</dt><dd><span>{change.before}</span><span aria-hidden="true">→</span><strong>{change.after}</strong></dd></div>)}</dl></details>}</li>)}</ol> : <p className="store-detail-muted">Không có nhật ký trong 200 sự kiện cửa hàng gần nhất.</p>}
        </section>
      </div>
      <footer className="store-detail-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Đóng</button><button type="button" className="btn btn-primary" onClick={() => onEdit(store)}>{Icons.edit} Chỉnh sửa</button></footer>
    </aside>
  </div>
}
