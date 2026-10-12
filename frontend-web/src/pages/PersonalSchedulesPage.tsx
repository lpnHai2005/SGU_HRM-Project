import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { operationToday } from './ActivityPage'
import { MonthPicker } from '../components/common/MonthPicker'
export function PersonalSchedulesPage() {
 const [period,setPeriod]=useState(operationToday().slice(0,7))
 const [rows,setRows]=useState<any[]>([])
 const [error,setError]=useState('')
 useEffect(()=>{let live=true;api.get<any[]>('/mobile-attendance/my-schedules',{period}).then(v=>{if(live){setRows(v);setError('')}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[period])
 return <section className="card" style={{padding:24}}><h1>Lịch ca & Phân công</h1><MonthPicker value={period} onChange={setPeriod} label="Tháng tra cứu"/>{error&&<p role="alert">{error}</p>}<div className="table-container"><table className="data-table"><thead><tr><th>Ngày</th><th>Ca</th><th>Giờ làm</th><th>Cửa hàng</th></tr></thead><tbody>{rows.map(r=><tr key={r.schedule_id}><td>{r.work_date.split('-').reverse().join('/')}</td><td>{r.shift_name}</td><td>{r.start_time?.slice(0,5)} – {r.end_time?.slice(0,5)}</td><td>{r.store_name}</td></tr>)}</tbody></table>{!rows.length&&!error&&<p>Chưa có lịch trong kỳ này.</p>}</div></section>
}
