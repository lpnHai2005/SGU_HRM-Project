import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../services/api'
import { Icons } from '../components/common/Icons'
import { DatePicker } from '../components/common/DatePicker'
import { StoreLocationStep, validStoreLocation, type StoreLocation } from '../components/StoreLocationStep'
import { StoreActionMenu } from '../components/StoreActionMenu'
import { StoreDetailDrawer, type StoreDetailRecord } from '../components/StoreDetailDrawer'
import './StoreManagementPage.css'

type Store = StoreDetailRecord
type LifecycleIntent = { store: Store; kind: 'status' | 'delete' }
type StoreDeactivationCheck = { active_employees: number; future_shifts: number; open_attendance_sessions: number; pending_leave_requests: number; pending_overtime_reviews: number; can_deactivate: boolean }
type Person = { employee_id: number; store_id?: number | null; full_name?: string | null; assigned_store_names?: string; assigned_store_ids?: number[] }
type Province = { name: string; code: number; wards: { name: string; code: number }[] }
const emptyStore = (): Store => ({store_code:'TZ-',store_name:'',address:'',district:'',city:'TP. Hồ Chí Minh',
  open_date:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}),is_active:true,
  latitude:'',longitude:'',radius_meters:100,wifi_networks:[]})
const normalizeAdministrativeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^(thanh pho|tinh|tp\.?|phuong|xa)\s*/,'').replace(/[^a-z0-9]/g,'')
const locationFromStore = (store: Store): StoreLocation => ({
  latitude: store.latitude == null || String(store.latitude).trim() === '' ? null : Number(store.latitude),
  longitude: store.longitude == null || String(store.longitude).trim() === '' ? null : Number(store.longitude),
})

export function StoresPage() {
  const editorScrollRef = useRef<HTMLDivElement>(null)
  const [rows,setRows] = useState<Store[]>([])
  const [people,setPeople] = useState<Person[]>([])
  const [provinces,setProvinces] = useState<Province[]>([])
  const [form,setForm] = useState<Store | null>(null)
  const [wifiText,setWifiText] = useState('')
  const [editorStep,setEditorStep] = useState<'information' | 'location'>('information')
  const [locationDraft,setLocationDraft] = useState<StoreLocation>({ latitude:null, longitude:null })
  const [editorBaseline,setEditorBaseline] = useState('')
  const [discardOpen,setDiscardOpen] = useState(false)
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [pendingManager,setPendingManager] = useState<Person | null>(null)
  const [managerTransferConfirmed,setManagerTransferConfirmed] = useState(false)
  const [originalStoreCode,setOriginalStoreCode] = useState('')
  const [detailStore,setDetailStore] = useState<Store | null>(null)
  const [lifecycleIntent,setLifecycleIntent] = useState<LifecycleIntent | null>(null)
  const [lifecycleReason,setLifecycleReason] = useState('')
  const [deleteConfirmation,setDeleteConfirmation] = useState('')
  const [lifecycleBusy,setLifecycleBusy] = useState(false)
  const [handoffConfirmed,setHandoffConfirmed] = useState(false)
  const [handoffSummary,setHandoffSummary] = useState('')
  const [deactivationCheck,setDeactivationCheck] = useState<StoreDeactivationCheck | null>(null)
  const [deactivationCheckBusy,setDeactivationCheckBusy] = useState(false)
  const [searchInput,setSearchInput] = useState('')
  const [search,setSearch] = useState('')
  const [filterCity,setFilterCity] = useState('')
  const [filterStatus,setFilterStatus] = useState('')
  const [filterManager,setFilterManager] = useState('')
  const [filterGps,setFilterGps] = useState('')
  const [filterIp,setFilterIp] = useState('')
  const [page,setPage] = useState(1)
  const [pageSize,setPageSize] = useState<10 | 20 | 50>(10)

  const load = async () => {
    setLoading(true)
    try { setRows(await api.get<Store[]>('/stores')); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được cửa hàng') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    void load()
    api.get<Person[]>('/stores/managers').then(setPeople).catch(() => setPeople([]))
    fetch('/data/province.json').then(response => { if (!response.ok) throw new Error('Không tải được dữ liệu địa chỉ'); return response.json() })
      .then((data: Province[]) => setProvinces(data)).catch(() => toast.error('Không tải được danh mục tỉnh/phường'))
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => setSearch(searchInput.trim().toLocaleLowerCase('vi-VN')), 250); return () => window.clearTimeout(timer) }, [searchInput])
  useEffect(() => setPage(1), [search,filterCity,filterStatus,filterManager,filterGps,filterIp,pageSize])
  const hasGps = (store: Store) => {
    const lat = Number(store.latitude), lon = Number(store.longitude), radius = Number(store.radius_meters)
    return String(store.latitude).trim() !== '' && String(store.longitude).trim() !== ''
      && Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(radius)
      && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0) && radius > 0
  }
  const cities = useMemo(() => [...new Set(rows.map(store => store.city).filter(Boolean))].sort((a,b) => a.localeCompare(b,'vi')), [rows])
  const filteredRows = useMemo(() => rows.filter(store => {
    const searchable = [store.store_name,store.store_code,store.address,store.district,store.city,store.manager_name].join(' ').toLocaleLowerCase('vi-VN')
    return (!search || searchable.includes(search))
      && (!filterCity || store.city === filterCity)
      && (!filterStatus || (filterStatus === 'active' ? store.is_active : !store.is_active))
      && (!filterManager || (filterManager === 'assigned' ? Boolean(store.manager_employee_id) : !store.manager_employee_id))
      && (!filterGps || (filterGps === 'configured' ? hasGps(store) : !hasGps(store)))
      && (!filterIp || (filterIp === 'configured' ? Boolean(store.wifi_networks?.length) : !store.wifi_networks?.length))
  }), [rows,search,filterCity,filterStatus,filterManager,filterGps,filterIp])
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const hasFilters = Boolean(searchInput || filterCity || filterStatus || filterManager || filterGps || filterIp)
  const clearFilters = () => { setSearchInput(''); setSearch(''); setFilterCity(''); setFilterStatus(''); setFilterManager(''); setFilterGps(''); setFilterIp(''); setPage(1) }
  const edit = (store: Store) => { const networks=(store.wifi_networks || []).join('\n'); setOriginalStoreCode(store.store_code); setForm({...store}); setWifiText(networks); setEditorBaseline(JSON.stringify({ store, networks })); setLocationDraft(locationFromStore(store)); setEditorStep('information'); setDiscardOpen(false); setPendingManager(null); setManagerTransferConfirmed(false) }
  const update = (key: keyof Store, value: Store[keyof Store]) => setForm(current => current ? {...current,[key]:value} : current)
  const locationChanged = form && editorStep === 'location' && JSON.stringify(locationDraft) !== JSON.stringify(locationFromStore(form))
  const hasUnsavedChanges = Boolean(form && (JSON.stringify({ store:form, networks:wifiText }) !== editorBaseline || locationChanged))
  const closeEditor = () => { setForm(null); setPendingManager(null); setDiscardOpen(false); setEditorStep('information') }
  const requestCloseEditor = () => { if (busy) return; if (hasUnsavedChanges) setDiscardOpen(true); else closeEditor() }
  const openLocationStep = () => { if (!form) return; if (form.store_id) toast.warning('Thay đổi tọa độ sẽ ảnh hưởng đến vùng GPS dùng để xác thực chấm công của chi nhánh.'); setLocationDraft(locationFromStore(form)); setEditorStep('location'); setDiscardOpen(false) }
  const confirmLocation = () => { if (!validStoreLocation(locationDraft)) return; setForm(current => current ? { ...current, latitude:locationDraft.latitude!, longitude:locationDraft.longitude! } : current); setEditorStep('information') }
  useEffect(() => {
    if (!form) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [Boolean(form)])
  useEffect(() => {
    if (!lifecycleIntent) return
    const previous=document.body.style.overflow
    document.body.style.overflow='hidden'
    return () => { document.body.style.overflow=previous }
  }, [Boolean(lifecycleIntent)])
  useEffect(() => {
    if (editorStep === 'location') editorScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [editorStep])
  const selectedProvince = useMemo(() => provinces.find(item => normalizeAdministrativeName(item.name) === normalizeAdministrativeName(String(form?.city || ''))), [provinces, form?.city])
  const selectedWard = useMemo(() => selectedProvince?.wards.find(item => normalizeAdministrativeName(item.name) === normalizeAdministrativeName(String(form?.district || ''))), [selectedProvince, form?.district])

  const updateStoreCode = (value: string) => update('store_code', `TZ-${value.replace(/^TZ-?/i, '').replace(/^[-\s]+/, '')}`)
  const selectManager = (value: string) => {
    const managerId = value ? Number(value) : null
    setManagerTransferConfirmed(false)
    if (!managerId) { update('manager_employee_id', null); return }
    const person = people.find(item => item.employee_id === managerId)
    const otherIds = (person?.assigned_store_ids || []).filter(id => id !== form?.store_id)
    if (person && otherIds.length) { setPendingManager(person); return }
    setPendingManager(null); update('manager_employee_id', managerId)
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form) return
    if (!(form.store_id && form.store_code === originalStoreCode) && !/^TZ-[A-Z0-9][A-Z0-9-]{0,16}$/i.test(form.store_code.trim())) { toast.error('M\u00e3 c\u1eeda h\u00e0ng ph\u1ea3i c\u00f3 ti\u1ec1n t\u1ed1 TZ- v\u00e0 ph\u1ea7n m\u00e3 h\u1ee3p l\u1ec7.'); return }
    const latitude = Number(form.latitude), longitude = Number(form.longitude), radius = Number(form.radius_meters)
    if (String(form.latitude).trim() === '' || String(form.longitude).trim() === '' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0) || !Number.isFinite(radius) || radius < 10 || radius > 5000) { toast.error('H\u00e3y nh\u1eadp t\u1ecda \u0111\u1ed9 v\u00e0 b\u00e1n k\u00ednh GPS h\u1ee3p l\u1ec7; \u00f4 tr\u1ed1ng kh\u00f4ng \u0111\u01b0\u1ee3c chuy\u1ec3n th\u00e0nh 0.'); return }
    setBusy(true)
    try {
      const networks = wifiText.split(/[\n,;]/).map(value => value.trim()).filter(Boolean)
      const payload = {...form,manager_employee_id:form.manager_employee_id ? Number(form.manager_employee_id) : null,
        latitude,longitude,radius_meters:radius,wifi_networks:networks,manager_transfer_confirmed:managerTransferConfirmed}
      if (form.store_id) await api.put(`/stores/${form.store_id}`,payload)
      else await api.post('/stores',payload)
      closeEditor(); toast.success('Đã lưu cửa hàng, vùng GPS và mạng chấm công web'); await load()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Không lưu được cửa hàng') }
    finally { setBusy(false) }
  }
  const openLifecycleDialog = (store: Store, kind: LifecycleIntent['kind']) => {
    setLifecycleIntent({store,kind}); setLifecycleReason(''); setDeleteConfirmation(''); setHandoffConfirmed(false); setHandoffSummary(''); setDeactivationCheck(null)
    if (kind === 'status' && store.is_active) {
      setDeactivationCheckBusy(true)
      void api.get<StoreDeactivationCheck>(`/stores/${store.store_id}/deactivation-check`)
        .then(setDeactivationCheck).catch(cause => toast.error(cause instanceof Error ? cause.message : 'Không kiểm tra được điều kiện bàn giao cửa hàng'))
        .finally(() => setDeactivationCheckBusy(false))
    }
  }
  const submitLifecycle = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!lifecycleIntent || lifecycleBusy) return
    const {store,kind}=lifecycleIntent
    if (lifecycleReason.trim().length < 8) { toast.error('Nhập lý do ít nhất 8 ký tự.'); return }
    if (kind === 'delete' && deleteConfirmation.trim().toUpperCase() !== store.store_code.toUpperCase()) { toast.error('Mã cửa hàng xác nhận chưa khớp.'); return }
    setLifecycleBusy(true)
    try {
      if (kind === 'status') await api.request(`/stores/${store.store_id}/status`, {method:'PATCH',body:JSON.stringify({is_active:!store.is_active,reason:lifecycleReason.trim(),handoff_confirmed:handoffConfirmed,handoff_summary:handoffSummary.trim()})})
      else await api.request(`/stores/${store.store_id}`, {method:'DELETE',body:JSON.stringify({reason:lifecycleReason.trim(),confirm_store_code:deleteConfirmation.trim()})})
      toast.success(kind === 'delete' ? 'Đã xóa cửa hàng an toàn.' : store.is_active ? 'Đã ngừng hoạt động cửa hàng và vùng GPS.' : 'Đã kích hoạt lại cửa hàng.')
      setLifecycleIntent(null); await load()
    } catch (cause) {
      let message=cause instanceof Error ? cause.message : 'Không hoàn tất được thao tác cửa hàng'
      try {
        const detail=JSON.parse(message) as {message?:string;references?:Array<{table:string;records:number}>}
        if(detail.message) message=detail.message + (detail.references?.length ? ' ('+detail.references.map(item=>item.table+': '+item.records).join(', ')+')' : '')
      } catch { /* Plain API message. */ }
      toast.error(message)
    }
    finally { setLifecycleBusy(false) }
  }
  const storeActions = (store: Store) => <div className="store-row-actions">
    <button type="button" className="store-icon-action" aria-label={`Xem chi tiết ${store.store_name}`} title="Xem chi tiết" onClick={() => setDetailStore(store)}>{Icons.eye}</button>
    <button type="button" className="store-icon-action" aria-label={`Chỉnh sửa ${store.store_name}`} title="Chỉnh sửa" onClick={() => edit(store)}>{Icons.edit}</button>
    <StoreActionMenu storeName={store.store_name} isActive={store.is_active} onEditManager={() => edit(store)} onHistory={() => setDetailStore(store)} onToggleActive={() => openLifecycleDialog(store,'status')} onDelete={() => openLifecycleDialog(store,'delete')} />
  </div>
  const kpis = [
    { label: 'Tổng cửa hàng', value: rows.length, icon: Icons.store, action: clearFilters, active: !hasFilters },
    { label: 'Đang hoạt động', value: rows.filter(store => store.is_active).length, icon: Icons.checkCircle, action: () => { clearFilters(); setFilterStatus('active') }, active: filterStatus === 'active' },
    { label: 'Chưa có người phụ trách', value: rows.filter(store => !store.manager_employee_id).length, icon: Icons.users, action: () => { clearFilters(); setFilterManager('unassigned') }, active: filterManager === 'unassigned' },
    { label: 'Chưa giới hạn IP chấm công', value: rows.filter(store => !store.wifi_networks?.length).length, icon: Icons.shield, action: () => { clearFilters(); setFilterIp('unrestricted') }, active: filterIp === 'unrestricted' },
  ]
  return <div className="page-container stores-page">
    <header className="page-header"><div><h1>Quản lý cửa hàng</h1><p>Quản lý chi nhánh, người phụ trách và cấu hình chấm công.</p></div><button type="button" className="btn btn-primary" onClick={() => edit(emptyStore())}>{Icons.plus} Thêm cửa hàng</button></header>
    {error && <div className="store-load-error" role="alert"><span>{error}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>{Icons.refresh} Thử lại</button></div>}
    <section className="store-kpi-grid" aria-label="Thống kê cửa hàng">{loading ? Array.from({length:4},(_,index) => <div key={index} className="store-kpi-skeleton" aria-hidden="true" />) : kpis.map(kpi => <button key={kpi.label} type="button" className={`store-kpi-card kpi-hover-card ${kpi.active ? 'selected' : ''}`} onClick={kpi.action} aria-pressed={kpi.active}><span className="store-kpi-icon">{kpi.icon}</span><span className="store-kpi-label">{kpi.label}</span><strong>{kpi.value}</strong><span className="store-kpi-hint">Nhấn để lọc danh sách</span></button>)}</section>
    <section className="card store-directory">
      <div className="store-directory-header"><div><h2>Danh sách chi nhánh</h2><p>{loading ? 'Đang tải dữ liệu…' : `${filteredRows.length} / ${rows.length} cửa hàng`}</p></div></div>
      <div className="store-filter-toolbar">
        <label className="store-search"><span className="sr-only">Tìm cửa hàng</span>{Icons.search}<input className="form-input" type="search" placeholder="Tìm tên, mã TZ-, địa chỉ, người phụ trách…" value={searchInput} onChange={event => setSearchInput(event.target.value)} /></label>
        <div className="store-filter-grid">
          <label><span>Tỉnh / Thành phố</span><select className="form-select" value={filterCity} onChange={event => setFilterCity(event.target.value)}><option value="">Tất cả</option>{cities.map(city => <option key={city} value={city}>{city}</option>)}</select></label>
          <label><span>Trạng thái</span><select className="form-select" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="">Tất cả</option><option value="active">Đang hoạt động</option><option value="inactive">Tạm dừng</option></select></label>
          <label><span>Người phụ trách</span><select className="form-select" value={filterManager} onChange={event => setFilterManager(event.target.value)}><option value="">Tất cả</option><option value="assigned">Đã phân công</option><option value="unassigned">Chưa phân công</option></select></label>
          <label><span>GPS</span><select className="form-select" value={filterGps} onChange={event => setFilterGps(event.target.value)}><option value="">Tất cả</option><option value="configured">Đã cấu hình</option><option value="missing">Chưa cấu hình</option></select></label>
          <label><span>IP chấm công</span><select className="form-select" value={filterIp} onChange={event => setFilterIp(event.target.value)}><option value="">Tất cả</option><option value="configured">Có dải IP</option><option value="unrestricted">Không giới hạn (CIDR trống)</option></select></label>
        </div>
        <div className="store-filter-footer"><small>Danh sách CIDR trống hiện được backend hiểu là không giới hạn IP; chưa có cờ để tách trường hợp chưa cấu hình.</small><button type="button" className="btn btn-secondary btn-sm" disabled={!hasFilters} onClick={clearFilters}>Xóa bộ lọc</button></div>
      </div>
      {loading ? <div className="store-list-skeleton" aria-label="Đang tải cửa hàng">{Array.from({length:5},(_,index) => <div key={index} />)}</div> : visibleRows.length ? <>
        <div className="store-desktop-table table-container"><table className="data-table"><thead><tr><th>Cửa hàng</th><th>Khu vực</th><th>Người phụ trách</th><th>GPS</th><th>IP chấm công</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          {visibleRows.map(store => <tr key={store.store_id}><td><div className="store-table-stack"><strong className="store-name" title={store.store_name}>{store.store_name}</strong><small>{store.store_code}</small></div></td><td><div className="store-table-stack"><strong>{store.city}</strong><small title={store.address}>{[store.address,store.district].filter(Boolean).join(', ')}</small></div></td><td><div className="store-table-stack">{store.manager_name ? <strong>{store.manager_name}</strong> : <span className="store-unassigned">Chưa phân công</span>}{store.manager_code && <small>{store.manager_code}</small>}</div></td><td><div className="store-table-stack"><span className={`store-config-state ${hasGps(store) ? 'ready' : 'missing'}`}>{hasGps(store) ? 'Đã cấu hình' : 'Chưa cấu hình'}</span>{hasGps(store) && <small>Bán kính {store.radius_meters} m</small>}</div></td><td><div className="store-table-stack"><span className={`store-config-state ${store.wifi_networks?.length ? 'ready' : 'neutral'}`}>{store.wifi_networks?.length ? 'Đã cấu hình' : 'Không giới hạn'}</span><small>{store.wifi_networks?.length ? `${store.wifi_networks.length} dải IP` : 'CIDR trống'}</small></div></td><td><span className={`store-state ${store.is_active ? 'active' : 'inactive'}`}>{store.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></td><td>{storeActions(store)}</td></tr>)}
        </tbody></table></div>
        <div className="store-mobile-list">{visibleRows.map(store => <article className="store-mobile-card" key={store.store_id}><div className="store-mobile-head"><div><strong title={store.store_name}>{store.store_name}</strong><small>{store.store_code} · {store.city}</small></div><span className={`store-state ${store.is_active ? 'active' : 'inactive'}`}>{store.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div><p title={store.address}>{[store.address,store.district].filter(Boolean).join(', ')}</p><div className="store-mobile-facts"><span>{Icons.user} {store.manager_name || 'Chưa phân công'}</span><span>{Icons.mapPin} {hasGps(store) ? `GPS · ${store.radius_meters} m` : 'GPS chưa cấu hình'}</span><span>{Icons.shield} {store.wifi_networks?.length ? `${store.wifi_networks.length} dải IP` : 'IP không giới hạn'}</span></div>{storeActions(store)}</article>)}</div>
      </> : <div className="store-empty-state">{Icons.store}<strong>{rows.length ? 'Không tìm thấy cửa hàng phù hợp' : 'Chưa có cửa hàng'}</strong><p>{rows.length ? 'Thử thay đổi từ khóa hoặc bộ lọc.' : 'Thêm cửa hàng để bắt đầu quản lý chi nhánh.'}</p>{hasFilters && <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Xóa bộ lọc</button>}</div>}
      {!loading && filteredRows.length > 0 && <footer className="store-pagination"><span>Hiển thị {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredRows.length)} / {filteredRows.length}</span><label>Số dòng <select className="form-select" value={pageSize} onChange={event => setPageSize(Number(event.target.value) as 10 | 20 | 50)}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label><div><button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label="Trang trước">{Icons.chevronLeft}</button><strong>Trang {page}/{pageCount}</strong><button type="button" className="btn btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)} aria-label="Trang sau">{Icons.chevronRight}</button></div></footer>}
    </section>
    {lifecycleIntent && <div className="store-lifecycle-overlay" onMouseDown={event => { if(event.target===event.currentTarget && !lifecycleBusy) setLifecycleIntent(null) }}><form className="store-lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="store-lifecycle-title" onSubmit={submitLifecycle}>
      <header><span className="store-section-icon">{lifecycleIntent.kind === 'delete' ? Icons.alertTriangle : lifecycleIntent.store.is_active ? Icons.minusCircle : Icons.checkCircle}</span><div><h2 id="store-lifecycle-title">{lifecycleIntent.kind === 'delete' ? 'Xóa cửa hàng an toàn' : lifecycleIntent.store.is_active ? 'Ngừng hoạt động cửa hàng?' : 'Kích hoạt lại cửa hàng?'}</h2><p>{lifecycleIntent.store.store_name} · {lifecycleIntent.store.store_code}</p></div><button type="button" className="store-editor-close" aria-label="Đóng" disabled={lifecycleBusy} onClick={() => setLifecycleIntent(null)}>{Icons.x}</button></header>
      <div className="store-lifecycle-body">{lifecycleIntent.kind === 'status' ? lifecycleIntent.store.is_active ? <>
          <p>Chi nhánh sẽ chuyển sang trạng thái tạm dừng. Dữ liệu nhân viên, lịch, chấm công, doanh số và lương được giữ nguyên; nhân viên không thể check-in mới. Phiên cũ phải checkout trước khi tiếp tục.</p>
          <section className="store-deactivation-check" aria-live="polite"><strong>{deactivationCheckBusy ? 'Đang kiểm tra điều kiện bàn giao…' : 'Kiểm tra trước khi ngừng hoạt động'}</strong>{deactivationCheck && <ul><li>{deactivationCheck.active_employees} nhân viên đang làm việc cần điều chuyển hoặc xác nhận bàn giao</li><li>{deactivationCheck.future_shifts} ca tương lai cần hủy/chuyển theo quy trình</li><li>{deactivationCheck.open_attendance_sessions} phiên chấm công đang mở {deactivationCheck.open_attendance_sessions ? '— phải checkout trước' : '— đã sẵn sàng'}</li><li>{deactivationCheck.pending_leave_requests} đơn nghỉ phép chờ xử lý</li><li>{deactivationCheck.pending_overtime_reviews} lượt OT chờ HR đối chiếu</li></ul>}</section>
          <label className="store-handoff-confirm"><input type="checkbox" checked={handoffConfirmed} onChange={event=>setHandoffConfirmed(event.target.checked)} /><span>Tôi xác nhận đã xử lý hoặc bàn giao nhân sự và lịch tương lai được liệt kê.</span></label>
          <label className="form-group"><span className="form-label">Ghi chú bàn giao bắt buộc</span><textarea className="form-input" minLength={12} maxLength={1000} required value={handoffSummary} onChange={event=>setHandoffSummary(event.target.value)} placeholder="Nêu nơi tiếp nhận nhân sự, cách xử lý lịch và công việc còn tồn" /></label>
        </> : <p>Cửa hàng và vùng GPS sẽ được bật lại. Hãy phân công cửa hàng trưởng hợp lệ và kiểm tra cấu hình GPS trước khi kích hoạt.</p> : <><p>Chỉ xóa khi cửa hàng đã ngừng hoạt động và không còn nhân viên, lịch, chấm công hay dữ liệu nghiệp vụ tham chiếu. Nếu còn liên kết, hệ thống sẽ từ chối và liệt kê nơi đang dùng.</p><label className="form-group"><span className="form-label">Nhập mã {lifecycleIntent.store.store_code} để xác nhận</span><input className="form-input" value={deleteConfirmation} onChange={event=>setDeleteConfirmation(event.target.value)} autoComplete="off" /></label></>}
        <label className="form-group"><span className="form-label">Lý do bắt buộc</span><textarea className="form-input" minLength={8} maxLength={500} required value={lifecycleReason} onChange={event=>setLifecycleReason(event.target.value)} placeholder="Nhập lý do để lưu vào nhật ký kiểm toán" /></label>
      </div><footer><button type="button" className="btn btn-secondary" disabled={lifecycleBusy} onClick={() => setLifecycleIntent(null)}>Hủy</button><button type="submit" className={lifecycleIntent.kind === 'delete' ? 'btn btn-danger' : 'btn btn-primary'} disabled={lifecycleBusy || lifecycleReason.trim().length<8 || (lifecycleIntent.kind==='delete' && deleteConfirmation.trim().toUpperCase()!==lifecycleIntent.store.store_code.toUpperCase()) || (lifecycleIntent.kind==='status' && lifecycleIntent.store.is_active && (deactivationCheckBusy || !deactivationCheck?.can_deactivate || !handoffConfirmed || handoffSummary.trim().length<12))}>{lifecycleBusy ? 'Đang xử lý…' : lifecycleIntent.kind==='delete' ? 'Xóa cửa hàng' : lifecycleIntent.store.is_active ? 'Ngừng hoạt động' : 'Kích hoạt lại'}</button></footer>
    </form></div>}
    {detailStore && <StoreDetailDrawer store={detailStore} onClose={() => setDetailStore(null)} onEdit={store => { setDetailStore(null); edit(store) }} />}
    {form && <div className="store-editor-overlay" onMouseDown={event => { if (event.target === event.currentTarget) requestCloseEditor() }}>
      <section className={'store-editor-drawer ' + (editorStep === 'location' ? 'map-step' : '')} role="dialog" aria-modal="true" aria-labelledby="store-editor-title">
        <header className="store-editor-drawer-header">
          {editorStep === 'location' && <button type="button" className="store-editor-back" onClick={() => { setLocationDraft(locationFromStore(form)); setEditorStep('information') }} aria-label="Quay lại">{Icons.chevronLeft}</button>}
          <div><h2 id="store-editor-title">{editorStep === 'location' ? 'Chọn vị trí cửa hàng' : form.store_id ? 'Chỉnh sửa cửa hàng — ' + form.store_code : 'Thêm cửa hàng mới'}</h2><p>{editorStep === 'location' ? 'Di chuyển bản đồ và đặt ghim tại vị trí thực tế của cửa hàng.' : 'Thiết lập thông tin chi nhánh và vùng chấm công.'}</p></div>
          <button type="button" className="store-editor-close" aria-label="Đóng" onClick={requestCloseEditor}>{Icons.x}</button>
        </header>
        <div ref={editorScrollRef} className="store-editor-scroll">
          {editorStep === 'information' ? <form id="store-editor-form" className="store-editor-form" onSubmit={save}>
            <section className="store-editor-section"><div className="store-editor-section-title"><span className="store-section-icon">{Icons.store}</span><div><h3>Thông tin cơ bản</h3><p>Mã, tên và người phụ trách chi nhánh.</p></div></div>
              <div className="store-editor-fields">
                <label className="form-group"><span className="form-label">Mã cửa hàng</span><span className="store-code-field"><span>TZ-</span><input className="form-input" required maxLength={17} value={String(form.store_code || '').replace(/^TZ-?/i, '')} onChange={event => updateStoreCode(event.target.value)} placeholder="001" /></span></label>
                <label className="form-group"><span className="form-label">Tên cửa hàng</span><input className="form-input" required maxLength={150} value={form.store_name} onChange={event => update('store_name', event.target.value)} /></label>
                <DatePicker label="Ngày mở cửa" value={form.open_date} onChange={value => update('open_date', value)} />
                <label className="form-group"><span className="form-label">Người phụ trách</span><select className="form-select" value={form.manager_employee_id || ''} onChange={event => selectManager(event.target.value)}><option value="">Chưa phân công</option>{people.map(person => <option key={person.employee_id} value={person.employee_id}>{person.full_name || '#' + person.employee_id}{person.assigned_store_names ? ' — đang phụ trách: ' + person.assigned_store_names : ''}</option>)}</select><small>Chỉ nhân viên có vai trò Cửa hàng trưởng.</small></label>
              </div>
              {pendingManager && <div className="store-manager-confirm" role="alertdialog" aria-labelledby="manager-transfer-title"><strong id="manager-transfer-title">Xác nhận chuyển cửa hàng trưởng</strong><p>{pendingManager.full_name} đang phụ trách {pendingManager.assigned_store_names || 'chi nhánh khác'}. Chuyển sang chi nhánh này? Lịch làm việc và hợp đồng không thay đổi.</p><div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPendingManager(null)}>Hủy</button><button type="button" className="btn btn-primary btn-sm" onClick={() => { update('manager_employee_id', pendingManager.employee_id); setManagerTransferConfirmed(true); setPendingManager(null) }}>Xác nhận chuyển</button></div></div>}
              <label className="store-active-switch"><input type="checkbox" checked={form.is_active} disabled readOnly /> Cửa hàng {form.is_active ? 'đang hoạt động' : 'đang ngừng hoạt động'}</label><small>Dùng mục Thao tác khác trên danh sách để đổi trạng thái và lưu lý do kiểm toán.</small>
            </section>
            <section className="store-editor-section"><div className="store-editor-section-title"><span className="store-section-icon">{Icons.mapPin}</span><div><h3>Địa chỉ cửa hàng</h3><p>Địa chỉ hành chính nhập thủ công, tách khỏi tọa độ GPS.</p></div></div>
              <div className="store-editor-fields">
                <label className="form-group"><span className="form-label">Tỉnh / Thành phố</span><select className="form-select" required value={selectedProvince ? String(selectedProvince.code) : 'legacy:' + form.city} onChange={event => { const province=provinces.find(item=>String(item.code)===event.target.value); if(province){update('city',province.name);update('district','')} }}><option value="">Chọn tỉnh / thành phố</option>{form.city && !selectedProvince && <option value={'legacy:' + form.city}>{form.city} (địa chỉ hiện tại)</option>}{provinces.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
                <label className="form-group"><span className="form-label">Phường / Xã</span><select className="form-select" required disabled={!selectedProvince} value={selectedWard ? String(selectedWard.code) : 'legacy:' + form.district} onChange={event => { const ward=selectedProvince?.wards.find(item=>String(item.code)===event.target.value); if(ward) update('district',ward.name) }}><option value="">Chọn phường / xã</option>{form.district && !selectedWard && <option value={'legacy:' + form.district}>{form.district} (địa chỉ hiện tại)</option>}{selectedProvince?.wards.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
                <label className="form-group store-wide-field"><span className="form-label">Số nhà, tên đường</span><input className="form-input" required maxLength={255} value={form.address} onChange={event => update('address',event.target.value)} placeholder="Nhập địa chỉ cửa hàng" /></label>
              </div>
            </section>
            <section className="store-editor-section"><div className="store-editor-section-title"><span className="store-section-icon">{Icons.shield}</span><div><h3>Cấu hình chấm công</h3><p>Vị trí GPS cho mobile và IP nguồn cho web.</p></div></div>
              <div className="store-location-summary"><div><strong>Vị trí GPS</strong><small>{validStoreLocation(locationFromStore(form)) ? Number(form.latitude).toFixed(6) + ', ' + Number(form.longitude).toFixed(6) : 'Chưa đặt ghim GPS'}</small><small>Bán kính hiện tại: {form.radius_meters} m</small></div><button type="button" className="btn btn-secondary btn-sm" onClick={openLocationStep}>{Icons.mapPin} {validStoreLocation(locationFromStore(form)) ? 'Chỉnh vị trí' : 'Chọn trên bản đồ'}</button></div>
              <div className="store-editor-fields"><label className="form-group"><span className="form-label">Bán kính GPS (m)</span><input className="form-input" type="number" required min={10} max={5000} step={1} value={form.radius_meters} onChange={event => update('radius_meters',event.target.value)} /></label></div>
              <label className="form-group"><span className="form-label">IP hoặc dải CIDR chấm công web</span><textarea className="form-input store-networks-input" value={wifiText} onChange={event => setWifiText(event.target.value)} placeholder={'192.168.1.0/24\n203.0.113.25/32'} /><small>Trạng thái: {wifiText.trim() ? 'Đã cấu hình dải IP' : 'Không giới hạn IP (CIDR trống)'}. Mỗi dòng một giá trị. Tên Wi-Fi/SSID không thể xác minh từ trình duyệt.</small></label>
            </section>
          </form> : <StoreLocationStep location={locationDraft} radius={Number(form.radius_meters)} provinces={provinces.map(({name,code}) => ({name,code}))} onChange={setLocationDraft} />}
        </div>
        {discardOpen && <div className="store-discard-confirm" role="alertdialog" aria-labelledby="store-discard-title"><strong id="store-discard-title">Bỏ thay đổi chưa lưu?</strong><p>Các chỉnh sửa trong cửa hàng sẽ không được lưu.</p><div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDiscardOpen(false)}>Tiếp tục chỉnh sửa</button><button type="button" className="btn btn-danger btn-sm" onClick={closeEditor}>Bỏ thay đổi</button></div></div>}
        <footer className="store-editor-drawer-footer">{editorStep === 'information' ? <><button type="button" className="btn btn-secondary" disabled={busy} onClick={requestCloseEditor}>Hủy</button><button type="submit" form="store-editor-form" className="btn btn-primary" disabled={busy || Boolean(pendingManager)}>{busy ? 'Đang lưu…' : 'Lưu cửa hàng'}</button></> : <><button type="button" className="btn btn-secondary" onClick={() => { setLocationDraft(locationFromStore(form)); setEditorStep('information') }}>Quay lại</button><button type="button" className="btn btn-secondary" onClick={() => setLocationDraft({latitude:null,longitude:null})}>Xóa ghim</button><button type="button" className="btn btn-primary" disabled={!validStoreLocation(locationDraft)} onClick={confirmLocation}>Xác nhận vị trí</button></>}</footer>
      </section>
    </div>}
  </div>
}
