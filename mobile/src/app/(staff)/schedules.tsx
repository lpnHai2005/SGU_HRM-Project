import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { vietnamPeriod } from '@/services/attendance';
import type { Schedule } from '@/services/staff';
export default function Schedules() {
  const p=usePalette(); const [period,setPeriod]=useState(vietnamPeriod); const [applied,setApplied]=useState(vietnamPeriod); const [invalid,setInvalid]=useState('');
  const {data,error,loading,reload}=useResource<Schedule[]>(`/mobile-attendance/my-schedules?period=${applied}`);
  return <ScrollView style={{backgroundColor:p.bg}} contentContainerStyle={styles.content}><Label large>Lịch được phân công</Label><Input value={period} onChangeText={setPeriod} placeholder="YYYY-MM" accessibilityLabel="Tháng lịch biểu" />
    <Button title="Xem lịch" onPress={()=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(period)){setInvalid('');setApplied(period);reload();}else setInvalid('Nhập tháng YYYY-MM.');}} />
    <LoadingBar active={loading} />{!!(error||invalid)&&<Text style={{color:p.danger}}>{error||invalid}</Text>}
    {data?.map(s=><Card key={s.schedule_id}><Label>{s.work_date}</Label><Label large>{s.shift_name}</Label><Label>{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</Label><Label muted>{s.store_name}</Label></Card>)}
    {data?.length===0&&!loading&&<Card><Label>Chưa có lịch phân ca trong tháng này.</Label><Label muted>Bạn vẫn có thể chọn ca thực tế để chấm công.</Label></Card>}
  </ScrollView>;
}
