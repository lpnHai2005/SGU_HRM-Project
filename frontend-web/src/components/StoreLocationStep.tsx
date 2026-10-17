import { useEffect, useState } from 'react'
import { Icons } from './common/Icons'
import { StoreMapPicker } from './StoreMapPicker'

export type StoreLocation = { latitude: number | null; longitude: number | null }
export type MapProvince = { name: string; code: number }
type BoundsRecord = { code: number; bbox: [number, number, number, number] }

export const validStoreLocation = (location: StoreLocation) => location.latitude !== null && location.longitude !== null
  && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
  && location.latitude >= -90 && location.latitude <= 90 && location.longitude >= -180 && location.longitude <= 180
  && !(location.latitude === 0 && location.longitude === 0)

const coordinateText = (value: number | null) => value !== null && Number.isFinite(value) ? value.toFixed(6) : '—'

export function StoreLocationStep({ location, radius, provinces, onChange }: {
  location: StoreLocation
  radius: number
  provinces: MapProvince[]
  onChange: (location: StoreLocation) => void
}) {
  const [selectedProvince, setSelectedProvince] = useState('')
  const [viewBounds, setViewBounds] = useState<[number, number, number, number] | null>(null)
  const [boundsByCode, setBoundsByCode] = useState<Record<number, BoundsRecord>>({})
  const [boundsError, setBoundsError] = useState('')
  const [zoom, setZoom] = useState(validStoreLocation(location) ? 16 : 10)
  const [selectedZoomPreset, setSelectedZoomPreset] = useState('custom')
  const [placementEnabled, setPlacementEnabled] = useState(false)
  const [focusPinTrigger, setFocusPinTrigger] = useState(0)
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0)

  useEffect(() => {
    let active = true
    fetch('/data/province-map-bounds.json')
      .then(response => { if (!response.ok) throw new Error('Không tải được dữ liệu điều hướng tỉnh/thành.'); return response.json() })
      .then((data: { provinces: BoundsRecord[] }) => {
        if (active) setBoundsByCode(Object.fromEntries(data.provinces.map(item => [item.code, item])))
      })
      .catch(() => { if (active) setBoundsError('Không tải được dữ liệu điều hướng tỉnh/thành. Tọa độ cửa hàng không thay đổi.') })
    return () => { active = false }
  }, [])

  const chooseProvince = (value: string) => {
    setSelectedProvince(value)
    setSelectedZoomPreset(value ? 'province' : 'custom')
    setBoundsError('')
    if (!value) { setViewBounds(null); return }
    const bbox = boundsByCode[Number(value)]?.bbox
    if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
      setBoundsError('Chưa có ranh giới hợp lệ cho tỉnh/thành này. Hãy thử tải lại trang.')
      setViewBounds(null)
      return
    }
    setViewBounds(bbox)
  }
  const changeCoordinate = (key: keyof StoreLocation, value: string) => {
    onChange({ ...location, [key]: value.trim() === '' ? null : Number(value) })
  }
  const chooseZoomPreset = (value: string) => {
    setSelectedZoomPreset(value)
    if (value === 'province') { setFitBoundsTrigger(current => current + 1); return }
    const next = value === 'area' ? 12 : value === 'street' ? 15 : value === 'detail' ? 17.5 : null
    if (next !== null) setZoom(next)
  }

  return <section className="store-location-step" aria-label="Chọn vị trí GPS">
    <div className="store-location-controls">
      <label className="form-group store-province-control"><span className="form-label">Bước 1 · Chọn Tỉnh / Thành phố</span><select className="form-select" value={selectedProvince} onChange={event => chooseProvince(event.target.value)}><option value="">Chọn khu vực trước khi đặt ghim</option>{provinces.map(province => <option key={province.code} value={province.code}>{province.name}</option>)}</select></label>
      <label className="form-group store-zoom-control"><span className="form-label">Mức zoom</span><select className="form-select" value={selectedZoomPreset} onChange={event => chooseZoomPreset(event.target.value)}><option value="province" disabled={!selectedProvince}>Toàn tỉnh</option><option value="area">Khu vực</option><option value="street">Đường phố</option><option value="detail">Chi tiết · Zoom 17–18</option><option value="custom">Tùy chỉnh · {zoom.toFixed(1)}</option></select></label>
    </div>
    <div className="store-zoom-slider-row"><label htmlFor="store-map-zoom">Thu phóng bản đồ <strong>{zoom.toFixed(1)}</strong></label><input id="store-map-zoom" type="range" min="5" max="20" step="0.1" value={zoom} onChange={event => { setSelectedZoomPreset('custom'); setZoom(Number(event.target.value)) }} aria-label="Mức zoom bản đồ từ 5 đến 20" /><div className="store-zoom-scale"><span>5</span><span>20</span></div></div>
    <p className="store-location-guidance">Chọn tỉnh/thành chỉ di chuyển bản đồ. Bật Đặt ghim rồi bấm bản đồ để chọn tọa độ thực tế; địa chỉ hành chính được nhập riêng trong form.</p>
    {boundsError && <p className="store-location-error" role="alert">{boundsError}</p>}
    <div className="store-location-map-wrap">
      <StoreMapPicker latitude={location.latitude} longitude={location.longitude} radius={radius} bounds={viewBounds} zoom={zoom} onZoomChange={(next, userInitiated) => { setZoom(next); if (userInitiated) setSelectedZoomPreset('custom') }} placementEnabled={placementEnabled} focusPinTrigger={focusPinTrigger} fitBoundsTrigger={fitBoundsTrigger} onChange={(latitude, longitude) => { onChange({ latitude, longitude }); setPlacementEnabled(false) }} />
      <button type="button" className={`btn store-place-button ${placementEnabled ? 'btn-primary active' : 'btn-secondary'}`} aria-pressed={placementEnabled} onClick={() => setPlacementEnabled(value => !value)}>{Icons.mapPin} {placementEnabled ? 'Đang đặt ghim' : 'Đặt ghim cửa hàng'}</button>
      {validStoreLocation(location) && <button type="button" className="btn btn-secondary store-focus-pin" onClick={() => setFocusPinTrigger(value => value + 1)}>{Icons.mapPin} Phóng đến ghim</button>}
    </div>
    <div className="store-location-summary"><div><span>Vĩ độ</span><strong title={String(location.latitude ?? '')}>{coordinateText(location.latitude)}</strong></div><div><span>Kinh độ</span><strong title={String(location.longitude ?? '')}>{coordinateText(location.longitude)}</strong></div><div><span>Bán kính GPS</span><strong>{Number.isFinite(radius) ? `${radius} m` : '—'}</strong></div><span className={`store-location-status ${validStoreLocation(location) ? 'selected' : ''}`}>{validStoreLocation(location) ? 'Đã chọn vị trí' : 'Chưa đặt ghim'}</span></div>
    <details className="store-location-manual"><summary>Nhập tọa độ thủ công</summary><div className="store-location-coordinates"><label className="form-group"><span className="form-label">Latitude</span><input className="form-input" type="number" min={-90} max={90} step="any" value={location.latitude ?? ''} onChange={event => changeCoordinate('latitude', event.target.value)} /></label><label className="form-group"><span className="form-label">Longitude</span><input className="form-input" type="number" min={-180} max={180} step="any" value={location.longitude ?? ''} onChange={event => changeCoordinate('longitude', event.target.value)} /></label></div></details>
  </section>
}
