import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button, Label, usePalette } from './attendance-ui';
import { LoadingBar } from './loading-bar';
import type { Fence } from '@/services/attendance';

export function AttendanceMap({ fence, position }: { fence: Fence; position?: { latitude: number; longitude: number } }) {
  const p = usePalette();
  const key = process.env.EXPO_PUBLIC_TRACKASIA_KEY;
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const html = useMemo(() => {
    const safe = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
    const style = `https://maps.track-asia.com/styles/v2/${p.dark ? 'night' : 'streets'}.json?key=${encodeURIComponent(key || '')}`;
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="https://unpkg.com/trackasia-gl@2.0.1/dist/trackasia-gl.css"><script src="https://unpkg.com/trackasia-gl@2.0.1/dist/trackasia-gl.js"></script><style>body{margin:0}#map{height:100vh}.trackasia-popup-content{color:#09090b;font:14px sans-serif}</style></head><body><div id="map"></div><script>
    const notify=(v)=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(v);
    window.onerror=()=>notify('error');
    const timer=setTimeout(()=>notify('error'),20000);
    try {
      const center=[${fence.longitude},${fence.latitude}];
      const map=new trackasiagl.Map({container:'map',style:${safe(style)},center,zoom:16});
      map.addControl(new trackasiagl.NavigationControl(),'top-right');
      map.on('error',()=>notify('error'));
      new trackasiagl.Marker({color:'#dc2626'}).setLngLat(center).setPopup(new trackasiagl.Popup().setText('Cửa hàng · ${Number(fence.radius_meters)} m')).addTo(map);
      ${position ? `const user=[${position.longitude},${position.latitude}]; new trackasiagl.Marker({color:'#2563eb'}).setLngLat(user).setPopup(new trackasiagl.Popup().setText('Bạn đang ở đây')).addTo(map).togglePopup(); map.fitBounds(new trackasiagl.LngLatBounds().extend(center).extend(user),{padding:45,maxZoom:17,duration:0});` : ''}
      map.on('load',()=>{
        clearTimeout(timer); notify('ready');
        const points=[];const r=${fence.radius_meters}/6371000;const lat=${fence.latitude}*Math.PI/180;const lon=${fence.longitude}*Math.PI/180;
        for(let i=0;i<=64;i++){const b=i/64*2*Math.PI; const y=Math.asin(Math.sin(lat)*Math.cos(r)+Math.cos(lat)*Math.sin(r)*Math.cos(b)); const x=lon+Math.atan2(Math.sin(b)*Math.sin(r)*Math.cos(lat),Math.cos(r)-Math.sin(lat)*Math.sin(y));points.push([x*180/Math.PI,y*180/Math.PI]);}
        map.addSource('fence',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[points]}}});
        map.addLayer({id:'fence-fill',type:'fill',source:'fence',paint:{'fill-color':'#2563eb','fill-opacity':0.12}});
        map.addLayer({id:'fence-line',type:'line',source:'fence',paint:{'line-color':'#2563eb','line-width':2}});
      });
    } catch(e) { clearTimeout(timer); notify('error'); }
    </script></body></html>`;
  }, [key, p.dark, fence.latitude, fence.longitude, fence.radius_meters, position]);
  if (!key) return <Label muted>Chưa cấu hình khóa bản đồ Track Asia. Vị trí vẫn do máy chủ kiểm tra.</Label>;
  if (Platform.OS === 'web') return <iframe title="Vị trí chấm công" srcDoc={html} sandbox="allow-scripts" style={{ height: 300, width: '100%', border: 0, borderRadius: 12 }} />;
  return <View style={{ gap: 8 }}>
    <LoadingBar active={loading && !failed} label="Đang tải bản đồ…" />
    {failed && <><Label muted>Không tải được bản đồ. Kiểm tra Internet hoặc khóa Track Asia; tọa độ bên dưới vẫn được giữ.</Label><Button title="Tải lại bản đồ" secondary onPress={() => { setFailed(false); setLoading(true); setAttempt(v => v + 1); }} /></>}
    <View style={{ height: 300, borderRadius: 12, overflow: 'hidden' }}><WebView key={attempt} source={{ html }} originWhitelist={['*']} javaScriptEnabled
      onShouldStartLoadWithRequest={req => req.url === 'about:blank' || req.url.startsWith('about:blank#')}
      onError={() => { setFailed(true); setLoading(false); }} onHttpError={() => { setFailed(true); setLoading(false); }}
      onMessage={event => { setLoading(false); setFailed(event.nativeEvent.data !== 'ready'); }} /></View>
    <Label muted>Đỏ: cửa hàng · Xanh: bạn · Vòng tròn: vùng cho phép</Label>
  </View>;
}
