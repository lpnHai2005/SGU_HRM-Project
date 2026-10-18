import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Icons } from '../common/Icons'
import { overtimeStatusClass, overtimeStatusLabel } from '../schedule/overtimeDisplay'
import { api } from '../../services/api'
import './NotificationBell.css'

type Notice = { id: string; title: string; href: string; is_read: boolean; category?: string; tone?: 'success' | 'warning' | 'error' | 'info'; overtime_status?: string; created_at?: string | null }

const noticeTone = (item: Notice) => item.tone || 'info'
const noticeIcon = (item: Notice) => item.category === 'Chấm công' ? Icons.clock : noticeTone(item) === 'error' ? Icons.xCircle : noticeTone(item) === 'success' ? Icons.checkCircle : Icons.calendar

export function NotificationBell({ user }: { user: { user_id: number } }) {
  const [items, setItems] = useState<Notice[]>([])
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let live = true, initial = true, known = new Set<string>()
    const load = async () => {
      try {
        const rows = await api.get<Notice[]>('/operations/notifications')
        if (!live) return
        setItems(rows); setError('')
        if (!initial) rows.filter(row => !known.has(row.id) && !row.is_read).forEach(row => {
          const tone = noticeTone(row)
          if (tone === 'error') toast.error(row.title)
          else if (tone === 'success') toast.success(row.title)
          else if (tone === 'warning') toast.warning(row.title)
          else toast.info(row.title)
        })
        known = new Set(rows.map(row => row.id)); initial = false
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Không tải được thông báo')
      } finally { if (live) setLoading(false) }
    }
    void load()
    const timer = window.setInterval(load, 30000)
    return () => { live = false; clearInterval(timer) }
  }, [user.user_id])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  const unread = items.filter(item => !item.is_read).length
  const visible = filter === 'unread' ? items.filter(item => !item.is_read) : items
  const select = async (item: Notice) => {
    setOpen(false)
    if (!item.is_read) {
      try {
        await api.post(`/operations/notifications/${encodeURIComponent(item.id)}/read`, {})
        setItems(rows => rows.map(row => row.id === item.id ? { ...row, is_read: true } : row))
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'Không lưu được trạng thái thông báo')
      }
    }
    navigate(item.href)
  }
  return <div className="notification-root" ref={root}>
    <button className="topbar-icon-btn notification-trigger" aria-label={`Thông báo: ${unread} chưa đọc`} aria-expanded={open} aria-controls="notification-panel" onClick={() => setOpen(value => !value)}>
      {Icons.bell}{unread > 0 && <small className="notification-count">{unread > 99 ? '99+' : unread}</small>}
    </button>
    {open && <section id="notification-panel" className="notification-panel" aria-label="Danh sách thông báo">
      <header className="notification-panel-header"><div><h2>Thông báo</h2><small>{unread ? `${unread} thông báo chưa đọc` : 'Bạn đã đọc hết thông báo'}</small></div><button type="button" className="notification-close" aria-label="Đóng thông báo" onClick={() => setOpen(false)}>{Icons.x}</button></header>
      <div className="notification-tabs" role="group" aria-label="Lọc thông báo"><button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Tất cả</button><button type="button" className={filter === 'unread' ? 'active' : ''} aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Chưa đọc <span>{unread}</span></button></div>
      <div className="notification-list">
        {loading && <p className="notification-empty">Đang tải thông báo…</p>}
        {error && <p className="notification-empty" role="alert">{error}<button type="button" onClick={() => window.location.reload()}>Tải lại</button></p>}
        {!loading && !error && visible.length === 0 && <p className="notification-empty">{filter === 'unread' ? 'Không có thông báo chưa đọc.' : 'Chưa có thông báo nào.'}</p>}
        {visible.map(item => <button type="button" key={item.id} className={`notification-item tone-${noticeTone(item)} ${item.is_read ? 'is-read' : ''}`} onClick={() => void select(item)}><span className="notification-item-icon">{noticeIcon(item)}</span><span className="notification-item-body"><small>{item.category || 'Hoạt động'}</small><strong>{item.title}</strong>{item.category === 'Đăng ký OT' && item.overtime_status && <span className={`notification-overtime-status ${overtimeStatusClass(item.overtime_status)}`}>{overtimeStatusLabel(item.overtime_status)}</span>}{item.created_at && <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>}</span>{!item.is_read && <span className="notification-unread-dot" aria-label="Chưa đọc" />}</button>)}
      </div>
    </section>}
  </div>
}
