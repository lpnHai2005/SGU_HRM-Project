import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { roleApi, userApi } from '../services/api'
import type { Role, User } from '../types'

export function UserAccessPage({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [selected, setSelected] = useState<Record<number, number[]>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    try {
      const [accounts, availableRoles] = await Promise.all([userApi.getAll(), roleApi.getAll()])
      setUsers(accounts)
      setRoles(availableRoles)
      setSelected(Object.fromEntries(accounts.map(account => [account.user_id, availableRoles.filter(role => account.roles.includes(role.role_code)).map(role => role.role_id)])))
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Không tải được tài khoản') }
  }
  useEffect(() => { void load() }, [])

  const saveRoles = async (account: User) => {
    const ids = selected[account.user_id] || []
    if (!ids.length) { toast.warning('Cần chọn ít nhất một vai trò'); return }
    if (account.user_id === currentUserId && !ids.some(id => roles.find(role => role.role_id === id)?.role_code === 'ADMIN')) {
      toast.warning('Không thể tự gỡ quyền Admin'); return
    }
    setBusy(account.user_id)
    try { await userApi.updateRoles(account.user_id, ids); toast.success('Đã cập nhật vai trò'); await load() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Không cập nhật được vai trò') }
    finally { setBusy(null) }
  }
  const toggleStatus = async (account: User) => {
    if (account.user_id === currentUserId && account.is_active) return
    setBusy(account.user_id)
    try { await userApi.updateStatus(account.user_id, !account.is_active); toast.success('Đã cập nhật trạng thái tài khoản'); await load() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Không cập nhật được trạng thái') }
    finally { setBusy(null) }
  }
  const filtered = users.filter(account => `${account.username} ${account.full_name || ''} ${account.email}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page-container">
    <h1>Tài khoản & Phân quyền</h1>
    <p>Quản lý trạng thái và vai trò tài khoản. Các quyền chi tiết được cấp qua vai trò trong hệ thống.</p>
    {error && <p role="alert">{error}</p>}
    <section className="card" style={{ padding: 20, marginBottom: 20 }}>
      <label>Tìm tài khoản <input className="form-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên, tài khoản hoặc email" /></label>
      <div className="table-container"><table className="data-table"><thead><tr><th>Tài khoản</th><th>Nhân viên</th><th>Trạng thái</th><th>Vai trò</th><th>Thao tác</th></tr></thead><tbody>
        {filtered.map(account => <tr key={account.user_id}>
          <td><strong>{account.username}</strong><br /><small>{account.email}</small></td>
          <td>{account.full_name || 'Chưa liên kết'}</td>
          <td>{account.is_active ? 'Đang hoạt động' : 'Đã khóa'}</td>
          <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{roles.map(role => <label key={role.role_id} style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={(selected[account.user_id] || []).includes(role.role_id)} disabled={busy === account.user_id} onChange={event => setSelected(current => ({ ...current, [account.user_id]: event.target.checked ? [...(current[account.user_id] || []), role.role_id] : (current[account.user_id] || []).filter(id => id !== role.role_id) }))} /> {role.role_name}</label>)}</div></td>
          <td><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary btn-sm" disabled={busy === account.user_id} onClick={() => saveRoles(account)}>Lưu quyền</button><button className="btn btn-secondary btn-sm" disabled={busy === account.user_id || account.user_id === currentUserId && account.is_active} onClick={() => toggleStatus(account)}>{account.is_active ? 'Khóa' : 'Mở khóa'}</button></div></td>
        </tr>)}
      </tbody></table></div>
    </section>
    <section className="card" style={{ padding: 20 }}><h2>Vai trò trong hệ thống</h2><div className="table-container"><table className="data-table"><thead><tr><th>Vai trò</th><th>Quyền được khai báo</th></tr></thead><tbody>{roles.map(role => <tr key={role.role_id}><td>{role.role_name}</td><td>{role.permissions?.join(', ') || 'Chưa khai báo'}</td></tr>)}</tbody></table></div></section>
  </div>
}
