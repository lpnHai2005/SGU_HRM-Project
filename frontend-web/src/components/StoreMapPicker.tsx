import { useEffect, useRef, useState } from 'react'
import type { Map as TrackAsiaMap, Marker } from 'trackasia-gl'
import 'trackasia-gl/dist/trackasia-gl.css'

type Props = {
  latitude: number | null
  longitude: number | null
  radius: number
  bounds: [number, number, number, number] | null
  onChange: (latitude: number, longitude: number) => void
  readOnly?: boolean
  placementEnabled?: boolean
  zoom?: number
  onZoomChange?: (zoom: number, userInitiated?: boolean) => void
  focusPinTrigger?: number
  fitBoundsTrigger?: number
}
type LngLat = { lng: number; lat: number }
const DEFAULT_VIEW: [number, number] = [106, 16]
const validPoint = (lat: number | null, lon: number | null) => lat !== null && lon !== null
  && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90
  && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0)

function circleFeature(latitude: number, longitude: number, radius: number) {
  const earthRadius = 6_371_000
  const angularRadius = Math.max(radius, 1) / earthRadius
  const lat = latitude * Math.PI / 180
  const lon = longitude * Math.PI / 180
  const coordinates: [number, number][] = []
  for (let step = 0; step <= 64; step++) {
    const bearing = step / 64 * 2 * Math.PI
    const pointLat = Math.asin(Math.sin(lat) * Math.cos(angularRadius) + Math.cos(lat) * Math.sin(angularRadius) * Math.cos(bearing))
    const pointLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(lat), Math.cos(angularRadius) - Math.sin(lat) * Math.sin(pointLat))
    coordinates.push([pointLon * 180 / Math.PI, pointLat * 180 / Math.PI])
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [coordinates] } }
}

export function StoreMapPicker({ latitude, longitude, radius, bounds, onChange, readOnly = false, placementEnabled = false, zoom, onZoomChange, focusPinTrigger, fitBoundsTrigger }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<TrackAsiaMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)
  const createMarkerRef = useRef<((point: LngLat) => Marker) | null>(null)
  const changeRef = useRef(onChange)
  const pointRef = useRef({ latitude, longitude })
  const boundsRef = useRef(bounds)
  const placementRef = useRef(placementEnabled)
  const zoomChangeRef = useRef(onZoomChange)
  const [error, setError] = useState('')
  const [roadLabelInfo, setRoadLabelInfo] = useState('')
  const mapKey = import.meta.env.VITE_TRACKASIA_MAP_KEY
  useEffect(() => { changeRef.current = onChange }, [onChange])
  useEffect(() => { pointRef.current = { latitude, longitude } }, [latitude, longitude])
  useEffect(() => { boundsRef.current = bounds }, [bounds])
  useEffect(() => {
    placementRef.current = placementEnabled
    markerRef.current?.setDraggable(!readOnly && placementEnabled)
  }, [placementEnabled, readOnly])
  useEffect(() => { zoomChangeRef.current = onZoomChange }, [onZoomChange])

  useEffect(() => {
    if (!containerRef.current || !mapKey) return
    let disposed = false
    let zoomFrame = 0
    let labelDiagnosticHighZoom = false
    const hasPoint = validPoint(latitude, longitude)
    const center: [number, number] = hasPoint ? [longitude!, latitude!] : DEFAULT_VIEW
    void import('trackasia-gl').then(({ Map, Marker: TrackMarker, NavigationControl }) => {
      if (disposed || !containerRef.current) return
      const map = new Map({
        container: containerRef.current,
        // Raster streets keeps map labels in TrackAsia tiles; the vector streets
        // style currently returns 404 for its glyph PBFs in this environment.
        style: `https://maps.track-asia.com/styles/v2/streets-raster.json?key=${encodeURIComponent(mapKey)}`,
        center,
        zoom: Math.min(20, Math.max(5, zoom ?? (hasPoint ? 16 : 5))),
        minZoom: 5,
        maxZoom: 20,
      })
      mapRef.current = map
      map.addControl(new NavigationControl(), 'top-right')
      const drawGeofence = (lat: number, lon: number) => {
        if (!map.isStyleLoaded()) return
        const data = circleFeature(lat, lon, radius)
        const source = map.getSource('store-geofence') as { setData?: (value: ReturnType<typeof circleFeature>) => void } | undefined
        if (source) source.setData?.(data)
        else {
          map.addSource('store-geofence', { type: 'geojson', data })
          map.addLayer({ id: 'store-geofence-fill', type: 'fill', source: 'store-geofence', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.14 } })
          map.addLayer({ id: 'store-geofence-line', type: 'line', source: 'store-geofence', paint: { 'line-color': '#2563eb', 'line-width': 2 } })
        }
      }
      const setPoint = (point: LngLat) => {
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180 || (point.lat === 0 && point.lng === 0)) return
        if (!markerRef.current) createMarkerRef.current?.(point)
        if (!markerRef.current) return
        markerRef.current.setLngLat([point.lng, point.lat])
        changeRef.current(point.lat, point.lng)
        drawGeofence(point.lat, point.lng)
      }
      createMarkerRef.current = point => {
        const marker = new TrackMarker({ draggable: !readOnly && placementRef.current, color: '#2563eb' })
          .setLngLat([point.lng, point.lat]).addTo(map)
        marker.on('dragend', () => {
          const point = marker.getLngLat()
          setPoint(point)
        })
        markerRef.current = marker
        return marker
      }
      if (hasPoint) createMarkerRef.current({ lng: center[0], lat: center[1] })
      if (!readOnly) map.on('click', event => { if (placementRef.current) setPoint(event.lngLat) })
      const syncZoom = (event?: { originalEvent?: Event }) => {
        if (disposed || zoomFrame) return
        const userInitiated = Boolean(event?.originalEvent)
        zoomFrame = requestAnimationFrame(() => {
          zoomFrame = 0
          const currentZoom = map.getZoom()
          zoomChangeRef.current?.(Number(currentZoom.toFixed(1)), userInitiated)
          if (currentZoom >= 17 && !labelDiagnosticHighZoom) {
            labelDiagnosticHighZoom = true
            const style = map.getStyle()
            const roadLabels = (style.layers || []).filter(layer => layer.type === 'symbol'
              && (/road|street|highway|transport/i.test(layer.id) || Boolean((layer.layout as Record<string, unknown> | undefined)?.['text-field'])))
            const sources = Object.entries(style.sources || {})
            const rasterSources = sources.filter(([, source]) => source.type === 'raster')
            const unloadedSources = sources.filter(([sourceId]) => !map.isSourceLoaded(sourceId))
            setRoadLabelInfo(roadLabels.length
              ? `Style có ${roadLabels.length} lớp nhãn chữ; ${unloadedSources.length ? 'còn source tile chưa tải xong' : 'nguồn tile đã tải'}. Nếu thiếu tên đường, kiểm tra thuộc tính lớp nhãn và độ phủ dữ liệu khu vực.`
              : rasterSources.length
                ? `Style Streets Raster không có lớp nhãn riêng: tên đường được vẽ sẵn trong raster tile. ${unloadedSources.length ? 'Có source tile chưa tải; kiểm tra network/HTTP của tile.' : 'Source tile đã tải; nếu chưa có tên đường ở zoom 17–18, kiểm tra nội dung tile và độ phủ dữ liệu khu vực.'}`
                : 'Style hiện không có lớp nhãn đường nhận diện được. Kiểm tra cấu hình style/layers và nguồn tile TrackAsia.')
          } else if (currentZoom < 17 && labelDiagnosticHighZoom) {
            labelDiagnosticHighZoom = false
            setRoadLabelInfo('')
          }
        })
      }
      map.on('zoom', syncZoom)
      map.on('zoomend', syncZoom)
      map.on('load', () => {
        if (disposed) return
        const current = pointRef.current
        if (validPoint(current.latitude, current.longitude)) drawGeofence(current.latitude!, current.longitude!)
        const bbox = boundsRef.current
        if (bbox && bbox.every(Number.isFinite) && bbox[0] < bbox[2] && bbox[1] < bbox[3]) {
          map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 42, maxZoom: 9.5, duration: 900 })
        }
      })
      map.on('error', event => {
        if (disposed) return
        const failure = event.error as Error & { status?: number; url?: string }
        const status = Number(failure?.status || /\b(401|403|404|429|5\d\d)\b/.exec(failure?.message || '')?.[1])
        const detail = String(failure?.message || '').replace(/https?:\/\/\S+/g, '[dịch vụ TrackAsia]').slice(0, 180)
        if (status === 401 || status === 403) setError('TrackAsia từ chối khóa bản đồ (HTTP ' + status + '). Kiểm tra khóa còn hiệu lực và quyền dùng Map Tiles trên domain hiện tại.')
        else if (status === 429) setError('TrackAsia đang giới hạn yêu cầu (HTTP 429). Hãy kiểm tra hạn mức dịch vụ rồi tải lại bản đồ.')
        else if (status >= 500) setError('TrackAsia Map Tiles đang lỗi (HTTP ' + status + '). Hãy thử lại sau.')
        else if (/failed to fetch|network|load failed|timeout/i.test(detail)) setError('Trình duyệt không tải được Map Tiles từ TrackAsia. Kiểm tra mạng, DNS, VPN hoặc tiện ích chặn yêu cầu; không có tọa độ nào được tạo.')
        else setError('TrackAsia không tải được một thành phần bản đồ: ' + (detail || 'lỗi không xác định'))
      })
      const resizeObserver = new ResizeObserver(() => map.resize())
      resizeObserver.observe(containerRef.current)
      resizeRef.current = resizeObserver
    }).catch(() => { if (!disposed) setError('Không tải được thư viện bản đồ TrackAsia.') })
    return () => {
      disposed = true
      if (zoomFrame) cancelAnimationFrame(zoomFrame)
      markerRef.current?.remove()
      resizeRef.current?.disconnect()
      resizeRef.current = null
      mapRef.current?.remove()
      markerRef.current = null
      mapRef.current = null
      createMarkerRef.current = null
    }
    // Map is initialized once per modal open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (bounds && bounds.every(Number.isFinite) && bounds[0] < bounds[2] && bounds[1] < bounds[3]) {
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 42, maxZoom: 9.5, duration: 900 })
    }
  }, [bounds, fitBoundsTrigger])

  useEffect(() => {
    const map = mapRef.current
    if (map && zoom !== undefined && Math.abs(map.getZoom() - zoom) > 0.08) map.easeTo({ zoom: Math.min(20, Math.max(5, zoom)), duration: 100 })
  }, [zoom])

  useEffect(() => {
    const map = mapRef.current
    if (map && focusPinTrigger && validPoint(latitude, longitude)) map.flyTo({ center: [longitude!, latitude!], zoom: Math.max(map.getZoom(), 15), duration: 600 })
    // The trigger changes only when the user presses "Phóng đến ghim".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPinTrigger])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (validPoint(latitude, longitude)) {
      if (!markerRef.current) createMarkerRef.current?.({ lng: longitude!, lat: latitude! })
      markerRef.current?.setLngLat([longitude!, latitude!])
      const source = map.getSource('store-geofence') as { setData?: (value: ReturnType<typeof circleFeature>) => void } | undefined
      source?.setData?.(circleFeature(latitude!, longitude!, radius))
    } else {
      markerRef.current?.remove()
      markerRef.current = null
      if (map.isStyleLoaded() && map.getSource('store-geofence')) {
        if (map.getLayer('store-geofence-fill')) map.removeLayer('store-geofence-fill')
        if (map.getLayer('store-geofence-line')) map.removeLayer('store-geofence-line')
        map.removeSource('store-geofence')
      }
    }
  }, [latitude, longitude, radius])

  if (!mapKey) return <p className="store-map-message" role="status">Thiếu VITE_TRACKASIA_MAP_KEY. Bản đồ không khả dụng; không có tọa độ nào được tạo tự động.</p>
  return <div className="store-map-picker">
    {error && <p className="store-map-error" role="status">{error}</p>}
    <div className="store-map-canvas" ref={containerRef} aria-label="Bản đồ chọn vị trí cửa hàng" />
    {roadLabelInfo && <div className="store-map-help store-map-label-info" role="status">{roadLabelInfo}</div>}
    {!readOnly && <div className="store-map-help">{placementEnabled ? 'Bấm bản đồ hoặc kéo ghim để chọn tọa độ cửa hàng.' : 'Bật “Đặt ghim cửa hàng” để thay đổi tọa độ. Di chuyển bản đồ không đổi ghim.'}</div>}
  </div>
}
