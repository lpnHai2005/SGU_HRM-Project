import { useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { useSession } from '@/contexts/session';
import { ApiError, request } from '@/services/attendance';
import type { Profile } from '@/services/staff';
type LeaveType={leave_type_id:number;type_name:string;requires_attachment:boolean};
type Leave={request_id:number;leave_type_name:string;start_date:string;end_date:string;total_days:number;reason:string;status:string;rejection_reason?:string};
const statuses:Record<string,string>={PENDING:'Chờ cửa hàng duyệt',STORE_APPROVED:'Chờ nhân sự duyệt',HR_APPROVED:'Đã được duyệt',REJECTED:'Bị từ chối',CANCELLED:'Đã hủy'};
export default function Requests(){
  const p=usePalette();const {token,signOut}=useSession();const me=useResource<Profile>('/auth/me');
  const rows=useResource<Leave[]>(me.data?.employee_id ? `/leaves?employee_id=${me.data.employee_id}` : null);const types=useResource<LeaveType[]>('/leaves/types');
  const [form,setForm]=useState(false);const [kind,setKind]=useState<number|null>(null);const [start,setStart]=useState('');const [end,setEnd]=useState('');const [days,setDays]=useState('1');const [reason,setReason]=useState('');const [attachment,setAttachment]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const lock=useRef(false);
  async function submit(){
    if(!token||lock.current)return;
    const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
    if(!kind||!validDate(start)||!validDate(end)||start>end||!(Number(days)>0)||!reason.trim()){setError('Chọn loại đơn, ngày hợp lệ YYYY-MM-DD, số ngày dương và lý do.');return;}
    if(types.data?.find(t=>t.leave_type_id===kind)?.requires_attachment&&!/^https:\/\//.test(attachment)){setError('Loại đơn này cần đường dẫn HTTPS của tài liệu minh chứng.');return;}
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{await request('/leaves',token,{leave_type_id:kind,start_date:start,end_date:end,total_days:Number(days),reason:reason.trim(),attachment_url:attachment.trim()||null});setForm(false);setNotice('Đã gửi đơn, chờ duyệt theo quy trình của công ty.');setReason('');rows.reload();}
    catch(e){setError(e instanceof Error?e.message:'Không gửi được đơn.');if(e instanceof ApiError&&e.status===401)void signOut();else rows.reload();}
    finally{lock.current=false;setBusy(false);}
  }
  return <ScrollView style={{backgroundColor:p.bg}} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Label large>Đơn từ của bạn</Label><Button title={form?'Đóng mẫu đơn':'Tạo đơn nghỉ phép'} onPress={()=>setForm(v=>!v)} secondary disabled={busy}/>
    <LoadingBar active={rows.loading||types.loading||busy}/>{!!(error||rows.error||types.error)&&<Card><Text style={{color:p.danger}}>{error||rows.error||types.error}</Text><Button title="Tải lại danh sách" secondary onPress={()=>{rows.reload();types.reload();}}/></Card>}{!!notice&&<Card><Label>{notice}</Label></Card>}
    {form&&<Card><Label>Loại đơn</Label>{types.data?.map(t=><Button key={t.leave_type_id} title={t.type_name} secondary={kind!==t.leave_type_id} onPress={()=>setKind(t.leave_type_id)} disabled={busy}/>)}<Input placeholder="Từ ngày YYYY-MM-DD" accessibilityLabel="Ngày bắt đầu" value={start} onChangeText={setStart}/><Input placeholder="Đến ngày YYYY-MM-DD" accessibilityLabel="Ngày kết thúc" value={end} onChangeText={setEnd}/><Input placeholder="Số ngày xin nghỉ" accessibilityLabel="Số ngày nghỉ" value={days} onChangeText={setDays} keyboardType="decimal-pad"/><Input placeholder="Lý do" accessibilityLabel="Lý do nghỉ" multiline value={reason} onChangeText={setReason}/><Input placeholder="Link HTTPS tài liệu minh chứng (nếu cần)" accessibilityLabel="Tài liệu minh chứng" value={attachment} onChangeText={setAttachment} autoCapitalize="none"/><Label muted>Kiểm tra thông tin trước khi gửi. Nếu mất mạng sau khi gửi, tải lại danh sách để kiểm tra đơn trước khi gửi lần nữa.</Label><Button title="Gửi đơn" onPress={()=>void submit()} disabled={busy}/></Card>}
    {rows.data?.map(row=><Card key={row.request_id}><Label>{row.leave_type_name}</Label><Label muted>{row.start_date} → {row.end_date} · {row.total_days} ngày</Label><Label>{statuses[row.status]||'Đang xử lý'}</Label><Label muted>{row.reason}</Label>{!!row.rejection_reason&&<Label>Lý do từ chối: {row.rejection_reason}</Label>}</Card>)}
    {rows.data?.length===0&&!rows.loading&&<Card><Label>Bạn chưa có đơn từ.</Label></Card>}
  </ScrollView>;
}
