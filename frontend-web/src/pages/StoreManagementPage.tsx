import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api, employeeApi } from '../services/api'
import { Icons } from '../components/common/Icons'
import { DatePicker } from '../components/common/DatePicker'
import { StoreMapPicker } from '../components/StoreMapPicker'
import './StoreManagementPage.css'

type Store = {
  store_id?: number; store_code: string; store_name: string; address: string; district: string; city: string;
  open_date: string; manager_employee_id?: number | null; manager_name?: string | null; is_active: boolean;
  latitude: number | string; longitude: number | string; radius_meters: number | string; wifi_networks: string[]
}
type Person = { employee_id: number; store_id?: number | null; full_name?: string | null }
type Province = { name: string; code: number; wards: { name: string; code: number }[] }
type TrackAsiaFeature = { geometry: { type: string; coordinates: [number, number] }; properties: { name?: string; label?: string; old_label?: string; housenumber?: string; street?: string; region?: string; locality?: string; county?: string; old_region?: string; old_locality?: string; layer?: string; confidence?: number } }
const emptyStore = (): Store => ({store_code:'',store_name:'',address:'',district:'',city:'TP. Hồ Chí Minh',
  open_date:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}),is_active:true,
  latitude:'',longitude:'',radius_meters:100,wifi_networks:[]})
const normalizeAdministrativeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^(thanh pho|tinh|tp\.?|phuong|xa)\s*/,'').replace(/[^a-z0-9]/g,'')

export function StoresPage() {
  const [rows,setRows] = useState<Store[]>([])
  const [people,setPeople] = useState<Person[]>([])
  const [provinces,setProvinces] = useState<Province[]>([])
  const [form,setForm] = useState<Store | null>(null)
  const [wifiText,setWifiText] = useState('')
  const [poiQuery,setPoiQuery] = useState('')
  const [poiResults,setPoiResults] = useState<TrackAsiaFeature[]>([])
  const [poiBusy,setPoiBusy] = useState(false)
  const [poiError,setPoiError] = useState('')
  const [focusStore,setFocusStore] = useState(false)
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')

  const load = async () => {
    try { setRows(await api.get<Store[]>('/stores')); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được cửa hàng') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    void load()
    employeeApi.getAll().then(setPeople).catch(() => setPeople([]))
    fetch('/data/province.json').then(response => { if (!response.ok) throw new Error('Không tải được dữ liệu địa chỉ'); return response.json() })
      .then((data: Province[]) => setProvinces(data)).catch(() => toast.error('Không tải được danh mục tỉnh/phường'))
  }, [])
  const edit = (store: Store) => { setForm({...store}); setWifiText((store.wifi_networks || []).join('\n')); setPoiQuery(''); setPoiResults([]); setPoiError(''); setFocusStore(false) }
  const update = (key: keyof Store, value: Store[keyof Store]) => setForm(current => current ? {...current,[key]:value} : current)
  const selectedProvince = useMemo(() => provinces.find(item => normalizeAdministrativeName(item.name) === normalizeAdministrativeName(String(form?.city || ''))), [provinces, form?.city])
  const selectedWard = useMemo(() => selectedProvince?.wards.find(item => normalizeAdministrativeName(item.name) === normalizeAdministrativeName(String(form?.district || ''))), [selectedProvince, form?.district])

  useEffect(() => {
    const query = poiQuery.trim()
    if (!form || query.length < 3) { setPoiResults([]); setPoiError(''); return }
    let active = true
    const timer = window.setTimeout(async () => {
      setPoiBusy(true); setPoiError('')
      try {
        const params: Record<string, string | number> = { q: query }
        if (focusStore) {
          const lat = Number(form.latitude), lon = Number(form.longitude)
          if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) { params.focus_lat = lat; params.focus_lon = lon }
        }
        const response = await api.get<{ features: TrackAsiaFeature[] }>('/stores/poi-search', params)
        if (active) {
          setPoiResults(response.features || [])
          if (!response.features?.length) setPoiError('Không tìm thấy địa điểm phù hợp. Thử tên cửa hàng, đường hoặc địa danh khác.')
        }
      } catch (cause) { if (active) setPoiError(cause instanceof Error ? cause.message : 'Không tìm được địa điểm') }
      finally { if (active) setPoiBusy(false) }
    }, 400)
    return () => { active = false; window.clearTimeout(timer) }
  }, [poiQuery, focusStore, form?.latitude, form?.longitude, Boolean(form)])

  const selectPoi = (feature: TrackAsiaFeature) => {
    const [longitude, latitude] = feature.geometry.coordinates
    const properties = feature.properties
    const city = properties.region || properties.old_region || form?.city || ''
    const district = properties.locality || properties.old_locality || properties.county || ''
    const address = properties.label || properties.old_label || [properties.housenumber, properties.street, district, city].filter(Boolean).join(', ')
    setForm(current => current ? { ...current, address: address.slice(0,255), district, city, latitude, longitude } : current)
    setPoiQuery('')
    setPoiResults([])
    setPoiError('')
  }
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
        {([['store_code','Mã cửa hàng'],['store_name','Tên cửa hàng'],['address','Số nhà, tên đường']] as const).map(([key,label]) => <label className="form-group" key={key}><span className="form-label">{label}</span><input className="form-input" required maxLength={key==='store_code'?20:key==='store_name'?150:255} value={String(form[key] ?? '')} onChange={event => update(key,event.target.value)} /></label>)}
      </div><DatePicker label="Ngày mở cửa" value={form.open_date} onChange={value => update('open_date',value)}/>
      <h3>Địa chỉ hành chính</h3><div className="store-editor-grid">
        <label className="form-group"><span className="form-label">Tỉnh / Thành phố</span><select className="form-select" required value={selectedProvince ? String(selectedProvince.code) : `legacy:${form.city}`} onChange={event => { const province=provinces.find(item=>String(item.code)===event.target.value); if(province){update('city',province.name);update('district','')} }}><option value="">Chọn tỉnh / thành phố</option>{form.city && !selectedProvince && <option value={`legacy:${form.city}`}>{form.city} (địa chỉ hiện tại)</option>}{provinces.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label className="form-group"><span className="form-label">Phường / Xã</span><select className="form-select" required disabled={!selectedProvince} value={selectedWard ? String(selectedWard.code) : `legacy:${form.district}`} onChange={event => { const ward=selectedProvince?.wards.find(item=>String(item.code)===event.target.value); if(ward) update('district',ward.name) }}><option value="">Chọn phường / xã</option>{form.district && !selectedWard && <option value={`legacy:${form.district}`}>{form.district} (địa chỉ hiện tại)</option>}{selectedProvince?.wards.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      </div>
      <div className="store-poi-panel"><label className="form-group"><span className="form-label">Tìm kiếm cửa hàng / địa chỉ / POI</span><input className="form-input" value={poiQuery} onChange={event => setPoiQuery(event.target.value)} placeholder="Ví dụ: cửa hàng TechZone, 12 Nguyễn Huệ, ATM…" autoComplete="off" /></label>
        <label className="store-focus-toggle"><input type="checkbox" checked={focusStore} onChange={event => setFocusStore(event.target.checked)} /> Ưu tiên kết quả gần tọa độ cửa hàng hiện tại</label>
        <small>Tọa độ chỉ gửi khi bật tùy chọn trên. GPS của nhân viên không được dùng cho tìm kiếm địa điểm.</small>
        {poiBusy && <p className="store-poi-state" role="status">Đang tìm trên TrackAsia…</p>}
        {poiError && !poiBusy && <p className="store-poi-state" role="status">{poiError}</p>}
        {poiResults.length > 0 && <div className="store-poi-results" role="listbox" aria-label="Kết quả tìm địa điểm">{poiResults.map((feature,index) => { const p=feature.properties; const name=p.name || p.label || `Địa điểm ${index+1}`; const label=p.label || p.old_label || [p.street,p.locality,p.region].filter(Boolean).join(', '); return <button type="button" role="option" className="store-poi-option" key={`${name}-${feature.geometry.coordinates.join(',')}`} onClick={() => selectPoi(feature)}><span>{Icons.store}</span><span><strong>{name}</strong><small>{label}</small></span></button> })}</div>}
      </div>
      <label className="form-group"><span className="form-label">Người phụ trách</span><select className="form-select" disabled={!form.store_id} value={form.manager_employee_id || ''} onChange={event => update('manager_employee_id',event.target.value ? Number(event.target.value) : null)}><option value="">Chưa phân công</option>{people.filter(person => person.store_id === form.store_id).map(person => <option key={person.employee_id} value={person.employee_id}>{person.full_name || `#${person.employee_id}`}</option>)}</select></label>
      <h3>Vùng chấm công GPS</h3><div className="store-editor-grid">{([['latitude','Vĩ độ (Latitude)',-90,90],['longitude','Kinh độ (Longitude)',-180,180],['radius_meters','Bán kính (m)',10,5000]] as const).map(([key,label,min,max]) => <label className="form-group" key={key}><span className="form-label">{label}</span><input className="form-input" type="number" required step={key==='radius_meters'?'1':'any'} min={min} max={max} value={form[key]} onChange={event => update(key,event.target.value)} /></label>)}</div>
      {Number(form.latitude) !== 0 && Number(form.longitude) !== 0 && <StoreMapPicker latitude={Number(form.latitude)} longitude={Number(form.longitude)} radius={Number(form.radius_meters)} onChange={(latitude,longitude) => setForm(current => current ? {...current,latitude,longitude} : current)} />}
      <h3>IP cho chấm công web</h3><label className="form-group"><span className="form-label">IP hoặc dải CIDR, mỗi dòng một giá trị</span><textarea className="form-input store-networks-input" value={wifiText} onChange={event => setWifiText(event.target.value)} placeholder={'192.168.1.0/24\n203.0.113.25/32'} /><small>Backend kiểm tra IP nguồn thực tế của kết nối. Để trống thì không giới hạn IP. Trình duyệt không cung cấp tên Wi-Fi/SSID để xác minh.</small></label>
      <label className="store-active-switch"><input type="checkbox" checked={form.is_active} onChange={event => update('is_active',event.target.checked)}/> Cửa hàng hoạt động / cho phép chấm công</label></div>
      <footer className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setForm(null)}>Đóng</button><button className="btn btn-primary" disabled={busy}>{busy?'Đang lưu…':'Lưu cấu hình'}</button></footer>
    </form></div>}
  </div>
}
