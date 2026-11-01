import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Card, Button, Label, styles, usePalette } from './attendance-ui';
import { AppIcon } from './app-icon';
import { Choice, DayPicker, FilterPanel, WorkforceFilters, emptyFilters, operationToday, queryString } from './operations-controls';
import { useResource } from '@/hooks/use-resource';
import { statusLabels, type Profile } from '@/services/staff';
import { displayTime, scheduleLabels } from '@/services/attendance';
type Session={attendance_id:number;shift_name:string;attendance_store_name:string;check_in_time:string|null;check_out_time:string|null;actual_work_hours:number;late_minutes:number;early_minutes:number;overtime_hours:number;status:string;schedule_status:string};
type Person={employee_id:number;employee_name:string;department_name:string;store_name:string;sessions:Session[]};
export function ManagerActivity({profile,initialKind='all'}:{profile:Profile;initialKind?:string}) {
 const p=usePalette();const [day,setDay]=useState(operationToday);const [filters,setFilters]=useState(emptyFilters);const [applied,setApplied]=useState({day,...emptyFilters});const [kind,setKind]=useState(initialKind);const [group,setGroup]=useState('auto');const [expanded,setExpanded]=useState<number[]>([]);
 const options=useResource<any>('/operations/filter-options');
 const {data,error,loading,reload}=useResource<{summary:Record<string,number>;employees:Person[]}>(`/operations/activity?${queryString(applied)}`);
 const storeOnly=profile.roles?.includes('STORE_MANAGER')&&!profile.roles.some(r=>['ADMIN','HR_MANAGER'].includes(r));
 const grouped:Record<string,Person[]>={};const storeSelected=applied.store_id||storeOnly;
 const mode=group==='auto'?(applied.employee_id?'none':storeSelected?(applied.department_id?'employee':'department'):'store'):group;
 for(const person of data?.employees||[]){
  if(kind==='working'&&!person.sessions.some(s=>s.check_in_time&&!s.check_out_time))continue;
  if(kind==='late'&&!person.sessions.some(s=>Number(s.late_minutes)>15))continue;
  if(!['all','working','late'].includes(kind)&&!person.sessions.some(s=>s.status===kind))continue;
  const key=mode==='none'?'Danh sách':mode==='employee'?person.employee_name:mode==='department'?(person.department_name||'Chưa có phòng ban'):`${person.store_name||'Chưa có cửa hàng'}${group==='auto'&&!applied.department_id?' / '+(person.department_name||'Chưa có phòng ban'):''}`;
  (grouped[key]??=[]).push(person);
 }
 const labels:Record<string,string>={total:'Tổng nhân viên',checked_in:'Đã chấm công',working:'Đang làm',finished:'Đã kết thúc',not_checked_in:'Chưa chấm công',late:'Đi muộn',early:'Về sớm',overtime:'Giờ ngoài ca ghi nhận'};
 const primary = ['total', 'checked_in', 'not_checked_in'];
 const tone = (s: Session) => (!s.check_out_time && s.check_in_time ? p.indigoText : Number(s.late_minutes) > 15 ? p.amberText : p.emeraldText);
 const statusText = (s: Session) => (!s.check_out_time && s.check_in_time ? 'Đang làm' : Number(s.late_minutes) > 15 ? `Muộn ${s.late_minutes}′` : statusLabels[s.status] || 'Đã kết thúc');
 return (
  <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
   <Card style={{ gap: 10 }}>
    <DayPicker value={day} onChange={value => { setDay(value); setApplied({ ...applied, day: value }); }} />
    <FilterPanel>
     <WorkforceFilters value={filters} onChange={setFilters} options={options.data || { employees: [], departments: [], stores: [] }} storeOnly={storeOnly} storeId={profile.store_id} />
     <Button title="Lọc" onPress={() => { setApplied({ day, ...filters }); reload(); }} />
     <Button title="Đặt lại" secondary onPress={() => { setDay(operationToday()); setFilters(emptyFilters); setApplied({ day: operationToday(), ...emptyFilters }); setKind('all'); setGroup('auto'); }} />
    </FilterPanel>
   </Card>
   {!!(error || options.error) && <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}><Label style={{ color: p.dangerText }}>{error || options.error}</Label></Card>}
   {loading && <Label muted>Đang tải…</Label>}

   <View style={{ flexDirection: 'row', gap: 8 }}>
    {primary.map(key => (
     <Card key={key} style={{ flex: 1, padding: 12, gap: 4 }}>
      <Label muted variant="caption">{labels[key]}</Label>
      <Label style={{ fontFamily: 'MonoBold', fontSize: 20, color: key === 'checked_in' ? p.emeraldText : key === 'not_checked_in' ? p.amberText : p.text }}>{data?.summary?.[key] ?? '—'}</Label>
     </Card>
    ))}
   </View>
   <Card style={{ padding: 0, gap: 0, flexDirection: 'row', flexWrap: 'wrap' }}>
    {Object.entries(labels).filter(([key]) => !primary.includes(key)).map(([key, text], i) => (
     <View key={key} style={{ width: '50%', paddingHorizontal: 12, paddingVertical: 10, borderLeftWidth: i % 2 ? 1 : 0, borderTopWidth: i > 1 ? 1 : 0, borderColor: p.line, flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
      <Label muted variant="caption" style={{ flexShrink: 1 }}>{text}</Label>
      <Label style={{ fontFamily: 'MonoBold', fontSize: 13 }}>{data?.summary?.[key] ?? '—'}</Label>
     </View>
    ))}
   </Card>

   <View style={{ flexDirection: 'row', gap: 8 }}>
    <View style={{ flex: 1 }}><Choice label="Nhóm theo" value={group} onChange={setGroup} options={Object.entries({ auto: 'Tự động', store: 'Cửa hàng', department: 'Phòng ban', employee: 'Nhân viên', none: 'Không nhóm' }).map(([value, label]) => ({ value, label }))} /></View>
    <View style={{ flex: 1 }}><Choice label="Loại chấm công" value={kind} onChange={setKind} options={Object.entries({ all: 'Tất cả', working: 'Đang làm', late: 'Đi muộn (số phút)', NORMAL: statusLabels.NORMAL, LATE: statusLabels.LATE, EARLY: statusLabels.EARLY, LATE_AND_EARLY: statusLabels.LATE_AND_EARLY, OVERTIME: statusLabels.OVERTIME }).map(([value, label]) => ({ value, label }))} /></View>
   </View>

   {data && !Object.keys(grouped).length && <Label muted>Không có dữ liệu phù hợp.</Label>}
   {Object.entries(grouped).map(([key, people]) => (
    <View key={key} style={{ gap: 8 }}>
     <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Label style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted, flexShrink: 1 }}>{key}</Label>
      <Label style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted }}>{people.filter(x => x.sessions.length).length}/{people.length}</Label>
     </View>
     <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
      {people.map((person, i) => {
       const open = expanded.includes(person.employee_id) || !!applied.employee_id;
       const last = person.sessions[person.sessions.length - 1];
       const initials = person.employee_name.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase();
       return (
        <View key={person.employee_id} style={{ borderBottomWidth: i === people.length - 1 ? 0 : 1, borderBottomColor: p.line }}>
         <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setExpanded(v => v.includes(person.employee_id) ? v.filter(id => id !== person.employee_id) : [...v, person.employee_id])} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.surfaceLow, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' }}>
           <Label style={{ fontFamily: 'BeVietnamBold', fontSize: 11 }}>{initials}</Label>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
           <Label variant="bold" numberOfLines={1} style={{ fontSize: 13 }}>{person.employee_name}</Label>
           <Label muted numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
            {last ? `${displayTime(last.check_in_time).slice(0, 5)} → ${last.check_out_time ? displayTime(last.check_out_time).slice(0, 5) : '--:--'}` : 'Chưa chấm công'} · {person.sessions.length} phiên
           </Label>
          </View>
          {last
           ? <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: p.surfaceLow }}><Label style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: tone(last) }}>{statusText(last)}</Label></View>
           : <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: p.surfaceLow }}><Label style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: p.muted }}>Chưa chấm công</Label></View>}
          <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={p.muted} />
         </Pressable>
         {open && person.sessions.map(s => (
          <View key={s.attendance_id} style={{ marginHorizontal: 14, marginBottom: 10, padding: 10, borderRadius: 6, backgroundColor: p.surfaceLow, gap: 3 }}>
           <Label variant="bold" style={{ fontSize: 12 }}>{s.shift_name} · {s.attendance_store_name}</Label>
           <Label style={{ fontFamily: 'Mono', fontSize: 12 }}>{displayTime(s.check_in_time)} → {displayTime(s.check_out_time)}</Label>
           <Label muted style={{ fontSize: 12 }}>Giờ làm {s.actual_work_hours ?? 0}h · Trễ {s.late_minutes ?? 0}′ · Sớm {s.early_minutes ?? 0}′ · Ngoài ca {s.overtime_hours ?? 0}h</Label>
           <Label muted style={{ fontSize: 12 }}>{statusLabels[s.status] || s.status} · Đối chiếu: {scheduleLabels[s.schedule_status] || s.schedule_status}</Label>
          </View>
         ))}
        </View>
       );
      })}
     </Card>
    </View>
   ))}
  </ScrollView>
 );
}
