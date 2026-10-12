import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, employeeApi } from '../services/api'
import { Icons } from '../components/common/Icons'
import { DatePicker } from '../components/common/DatePicker'
import './StoreManagementPage.css'

type Store = {
  store_id?: number; store_code: string; store_name: string; address: string; district: string; city: string;
  open_date: string; manager_employee_id?: number | null; manager_name?: string | null; is_active: boolean;
  latitude: number | string; longitude: number | string; radius_meters: number | string; wifi_networks: string[]
}
type Person = { employee_id: number; store_id?: number | null; full_name?: string | null }
const emptyStore = (): Store => ({store_code:'',store_name:'',address:'',district:'',city:'TP. Hồ Chí Minh',
  open_date:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}),is_active:true,
  latitude:'',longitude:'',radius_meters:100,wifi_networks:[]})

export function StoresPage() {
  const [rows,setRows] = useState<Store[]>([])
  const [people,setPeople] = useState<Person[]>([])
  const [form,setForm] = useState<Store | null>(null)
  const [wifiText,setWifiText] = useState('')
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')

  const load = async () => {
    try { setRows(await api.get<Store[]>('/stores')); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được cửa hàng') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load(); employeeApi.getAll().then(setPeople).catch(() => setPeople([])) }, [])
  const edit = (store: Store) => { setForm({...store}); setWifiText((store.wifi_networks || []).join('\n')) }
  const update = (key: keyof Store, value: Store[keyof Store]) => setForm(current => current ? {...current,[key]:value} : current)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form) return
    setBusy(true)
    try {
      const networks = wifiText.split(/[\n,;]/).map(value => value.trim()).filter(Boolean)
      const payload = {...form,manager_employee_id:form.manager_employee_id ? Number(form.manager_employee_id) : null,
        latitude:Number(form.latitude),longitude:Number(form.longitude),radius_meters:Number(form.radius_meters),wifi_networks:networks}
      if (form.store_id) await api.put(`/stores/${form.store_id}`,payload)
      else await api.post('/stores',payload)
      setForm(null); toast.success('Đã lưu cửa hàng, vùng GPS và mạng chấm công web'); await load()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Không lưu được cửa hàng') }
    finally { setBusy(false) }
  }
  return <div className="page-container stores-page">
    <header className="page-header"><div><h1>Quản lý cửa hàng</h1><p>Điều chỉnh địa chỉ, vùng GPS và IP mạng được phép chấm công trên web.</p></div><button className="btn btn-primary" onClick={() => edit(emptyStore())}>{Icons.plus} Thêm cửa hàng</button></header>
    {error && <p role="alert" className="store-error">{error}</p>}
    <section className="card stores-table-wrap"><div className="table-container"><table className="data-table"><thead><tr><th>Cửa hàng</th><th>Địa chỉ</th><th>Quản lý</th><th>Vùng GPS</th><th>IP cho chấm công web</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      {rows.map(store => <tr key={store.store_id}><td><strong>{store.store_name}</strong><small>{store.store_code}</small></td><td>{store.address}<small>{store.district}, {store.city}</small></td><td>{store.manager_name || 'Chưa phân công'}</td><td><strong>{store.latitude}, {store.longitude}</strong><small>Bán kính {store.radius_meters} m</small></td><td>{store.wifi_networks?.length ? <><strong>{store.wifi_networks.length} dải IP</strong><small>{store.wifi_networks.join(', ')}</small></> : <span className="store-unrestricted">Chưa giới hạn</span>}</td><td><span className={`badge-status ${store.is_active?'active':'inactive'}`}>{store.is_active?'Hoạt động':'Tạm dừng'}</span></td><td><button className="btn btn-secondary btn-sm" onClick={() => edit(store)}>{Icons.edit} Chỉnh sửa</button></td></tr>)}
      {!loading && rows.length === 0 && <tr><td colSpan={7}>Chưa có cửa hàng.</td></tr>}
    </tbody></table></div></section>
    {form && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setForm(null) }}><form className="modal store-editor" role="dialog" aria-modal="true" aria-label="Cấu hình cửa hàng" onSubmit={save}>
      <header className="store-editor-header"><div><h2>{form.store_id ? 'Cập nhật cửa hàng' : 'Thêm cửa hàng'}</h2><p>Thông tin được lưu và ghi vào nhật ký thao tác.</p></div><button type="button" className="modal-close" aria-label="Đóng" onClick={() => setForm(null)}>{Icons.x}</button></header>
      <div className="store-editor-body"><h3>Thông tin chi nhánh</h3><div className="store-editor-grid">
        {([['store_code','Mã cửa hàng'],['store_name','Tên cửa hàng'],['address','Địa chỉ'],['district','Quận / Huyện'],['city','Tỉnh / Thành']] as const).map(([key,label]) => <label className="form-group" key={key}><span className="form-label">{label}</span><input className="form-input" required maxLength={key==='store_code'?20:key==='store_name'?150:255} value={String(form[key] ?? '')} onChange={event => update(key,event.target.value)} /></label>)}
      </div><DatePicker label="Ngày mở cửa" value={form.open_date} onChange={value => update('open_date',value)}/>
      <label className="form-group"><span className="form-label">Người phụ trách</span><select className="form-select" disabled={!form.store_id} value={form.manager_employee_id || ''} onChange={event => update('manager_employee_id',event.target.value ? Number(event.target.value) : null)}><option value="">Chưa phân công</option>{people.filter(person => person.store_id === form.store_id).map(person => <option key={person.employee_id} value={person.employee_id}>{person.full_name || `#${person.employee_id}`}</option>)}</select></label>
      <h3>Vùng chấm công GPS</h3><div className="store-editor-grid">{([['latitude','Vĩ độ (Latitude)',-90,90],['longitude','Kinh độ (Longitude)',-180,180],['radius_meters','Bán kính (m)',10,5000]] as const).map(([key,label,min,max]) => <label className="form-group" key={key}><span className="form-label">{label}</span><input className="form-input" type="number" required step={key==='radius_meters'?'1':'any'} min={min} max={max} value={form[key]} onChange={event => update(key,event.target.value)} /></label>)}</div>
      <h3>IP cho chấm công web</h3><label className="form-group"><span className="form-label">IP hoặc dải CIDR, mỗi dòng một giá trị</span><textarea className="form-input store-networks-input" value={wifiText} onChange={event => setWifiText(event.target.value)} placeholder={'192.168.1.0/24\n203.0.113.25/32'} /><small>Backend kiểm tra IP nguồn thực tế của kết nối. Để trống thì không giới hạn IP. Trình duyệt không cung cấp tên Wi-Fi/SSID để xác minh.</small></label>
      <label className="store-active-switch"><input type="checkbox" checked={form.is_active} onChange={event => update('is_active',event.target.checked)}/> Cửa hàng hoạt động / cho phép chấm công</label></div>
      <footer className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setForm(null)}>Đóng</button><button className="btn btn-primary" disabled={busy}>{busy?'Đang lưu…':'Lưu cấu hình'}</button></footer>
    </form></div>}
  </div>
}
