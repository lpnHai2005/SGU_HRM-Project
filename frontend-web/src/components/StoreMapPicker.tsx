import { useEffect, useRef, useState } from 'react'
import type { Map as TrackAsiaMap, Marker } from 'trackasia-gl'
import 'trackasia-gl/dist/trackasia-gl.css'

type Props = { latitude: number; longitude: number; radius: number; onChange: (latitude: number, longitude: number) => void }
type LngLat = { lng: number; lat: number }

function circleFeature(latitude: number, longitude: number, radius: number) {
  const earthRadius = 6_371_000
  const angularRadius = Math.max(radius, 10) / earthRadius
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

export function StoreMapPicker({ latitude, longitude, radius, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<TrackAsiaMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const changeRef = useRef(onChange)
  const [error, setError] = useState('')
  const mapKey = import.meta.env.VITE_TRACKASIA_MAP_KEY

  useEffect(() => { changeRef.current = onChange }, [onChange])

  useEffect(() => {
    if (!containerRef.current || !mapKey || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    let disposed = false
    const center: [number, number] = [longitude, latitude]
    void import('trackasia-gl').then(({ Map, Marker, NavigationControl }) => {
      if (disposed || !containerRef.current) return
      const map = new Map({
        container: containerRef.current,
        style: `https://maps.track-asia.com/styles/v2/streets.json?key=${encodeURIComponent(mapKey)}`,
        center,
        zoom: 16,
      })
      mapRef.current = map
      map.addControl(new NavigationControl(), 'top-right')
      const marker = new Marker({ draggable: true, color: '#2563eb' }).setLngLat(center).addTo(map)
      markerRef.current = marker
      const updatePoint = (point: LngLat) => {
        marker.setLngLat([point.lng, point.lat])
        changeRef.current(point.lat, point.lng)
      }
      map.on('click', event => updatePoint(event.lngLat))
      marker.on('dragend', () => updatePoint(marker.getLngLat()))
      map.on('load', () => {
        if (disposed) return
        map.addSource('store-geofence', { type: 'geojson', data: circleFeature(latitude, longitude, radius) })
        map.addLayer({ id: 'store-geofence-fill', type: 'fill', source: 'store-geofence', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.14 } })
        map.addLayer({ id: 'store-geofence-line', type: 'line', source: 'store-geofence', paint: { 'line-color': '#2563eb', 'line-width': 2 } })
      })
      map.on('error', () => setError('Không tải được bản đồ TrackAsia. Kiểm tra kết nối hoặc khóa bản đồ.'))
    }).catch(() => setError('Không tải được thư viện bản đồ TrackAsia.'))
    return () => {
      disposed = true
      markerRef.current?.remove()
      mapRef.current?.remove()
      markerRef.current = null
      mapRef.current = null
    }
    // The map is initialized once per editor lifetime; live values update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey])

  useEffect(() => {
    const map = mapRef.current
    markerRef.current?.setLngLat([longitude, latitude])
    const source = map?.getSource('store-geofence') as { setData?: (value: ReturnType<typeof circleFeature>) => void } | undefined
    source?.setData?.(circleFeature(latitude, longitude, radius))
  }, [latitude, longitude, radius])

  if (!mapKey) return <p className="store-map-message">Thiếu VITE_TRACKASIA_MAP_KEY trong frontend-web/.env. Tọa độ vẫn có thể nhập thủ công.</p>
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return <p className="store-map-message">Nhập tọa độ hợp lệ hoặc chọn một POI để mở bản đồ và vùng GPS.</p>

  return <div className="store-map-picker">
    {error && <p className="store-map-error" role="status">{error}</p>}
    <div className="store-map-canvas" ref={containerRef} aria-label="Bản đồ chọn vị trí cửa hàng" />
    <div className="store-map-help">Bấm lên bản đồ hoặc kéo ghim xanh để chỉnh vị trí. Vòng tròn thể hiện bán kính vùng chấm công.</div>
  </div>
}
