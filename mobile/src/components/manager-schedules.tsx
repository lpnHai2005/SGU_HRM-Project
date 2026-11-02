import { useState } from 'react';
import { Pressable, ScrollView, View, Switch } from 'react-native';
import { AppIcon, AppText as Text } from './app-icon';
import { Card, Label, styles, usePalette } from './attendance-ui';
import { DayPicker, FilterPanel, WorkforceFilters, emptyFilters, isoDate, operationToday, queryString } from './operations-controls';
import { useResource } from '@/hooks/use-resource';
import type { Profile, Schedule } from '@/services/staff';

type Row = Schedule & { employee_name: string; position_name: string; cancelled_at: string | null; notes: string | null };
const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export function ManagerSchedules({ profile }: { profile: Profile }) {
  const p = usePalette();
  const [day, setDay] = useState(operationToday);
  const [view, setView] = useState('week');
  const [filters, setFilters] = useState(emptyFilters);
  const [cancelled, setCancelled] = useState(false);
  const options = useResource<any>('/operations/filter-options');
  const { data, error, loading, reload } = useResource<Row[]>(`/work-schedules?${queryString({ day, view, ...filters, include_cancelled: cancelled })}`);
  const storeOnly = profile.roles?.includes('STORE_MANAGER') && !profile.roles.some(r => ['ADMIN', 'DIRECTOR', 'HR_MANAGER'].includes(r));
  const move = (step: number) => {
    const d = new Date(`${day}T12:00:00`);
    if (view === 'month') {
      const target = new Date(d.getFullYear(), d.getMonth() + step, 1);
      target.setDate(Math.min(d.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
      setDay(isoDate(target));
    } else {
      d.setDate(d.getDate() + step * (view === 'week' ? 7 : 1));
      setDay(isoDate(d));
    }
  };
  const monday = new Date(`${day}T12:00:00`);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const saturday = new Date(monday);
  saturday.setDate(saturday.getDate() + 5);
  const label = view === 'week'
    ? `${isoDate(monday).split('-').reverse().join('/')} – ${isoDate(saturday).split('-').reverse().join('/')}`
    : view === 'month' ? day.slice(0, 7).split('-').reverse().join('/') : day.split('-').reverse().join('/');
  const today = operationToday();
  const days = new Map<string, Row[]>();
  for (const s of [...(data || [])].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time))) {
    days.set(s.work_date, [...(days.get(s.work_date) || []), s]);
  }

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
      {/* Range navigation */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <NavButton icon="chevron-back" label="Trước" onPress={() => move(-1)} />
        <Pressable accessibilityRole="button" onPress={() => { setDay(operationToday()); reload(); }} style={{ height: 36, paddingHorizontal: 12, borderRadius: 6, backgroundColor: p.brand, justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.onBrand }}>Hôm nay</Text>
        </Pressable>
        <NavButton icon="chevron-forward" label="Sau" onPress={() => move(1)} />
        <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontFamily: 'Mono', fontSize: 12, color: p.body }}>{label}</Text>
      </View>

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 6, backgroundColor: p.surfaceLow }}>
        {([['day', 'Ngày'], ['week', 'Tuần (T2–T7)'], ['month', 'Tháng']] as const).map(([key, text]) => {
          const active = view === key;
          return (
            <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setView(key)} style={{ flex: 1, height: 32, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? p.line : 'transparent', backgroundColor: active ? p.card : 'transparent' }}>
              <Text style={{ fontFamily: active ? 'BeVietnamBold' : 'BeVietnam', fontSize: 12, color: active ? p.text : p.muted }}>{text}</Text>
            </Pressable>
          );
        })}
      </View>

      <Card style={{ gap: 10 }}>
        <DayPicker value={day} onChange={setDay} />
        <FilterPanel>
          <WorkforceFilters value={filters} onChange={setFilters} options={options.data || { employees: [], departments: [], stores: [] }} storeOnly={storeOnly} storeId={profile.store_id} showPosition />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Label>Hiện lịch đã hủy</Label>
            <Switch value={cancelled} onValueChange={setCancelled} />
          </View>
        </FilterPanel>
      </Card>

      {!!(error || options.error) && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.dangerText }}>{error || options.error}</Text>
        </Card>
      )}
      {loading && <Label muted>Đang tải lịch…</Label>}

      {[...days.entries()].map(([date, list]) => (
        <View key={date} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: date === today ? p.emeraldText : p.muted }}>
              {WEEKDAYS[new Date(`${date}T12:00:00`).getDay()]} · {date.slice(8, 10)}/{date.slice(5, 7)}{date === today ? ' · Hôm nay' : ''}
            </Text>
            <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted }}>{list.length} ca</Text>
          </View>
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {list.map((s, i) => {
              const off = !!s.cancelled_at;
              const initials = s.employee_name.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase();
              return (
                <View key={s.schedule_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: p.line, opacity: off ? 0.55 : 1 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.surfaceLow, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: p.text }}>{initials}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text, textDecorationLine: off ? 'line-through' : 'none' }}>{s.employee_name}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{off ? 'Đã hủy' : s.position_name || 'Chưa có chức vụ'}{s.notes ? ` · ${s.notes}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: 'MonoBold', fontSize: 12, color: p.text }}>{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{s.shift_name}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </View>
      ))}
      {data?.length === 0 && <Label muted>Không có lịch phù hợp.</Label>}
    </ScrollView>
  );

  function NavButton({ icon, label: text, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void }) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={onPress} style={{ height: 36, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: p.line, backgroundColor: p.card, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon === 'chevron-back' && <AppIcon name={icon} size={14} color={p.text} />}
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>{text}</Text>
        {icon === 'chevron-forward' && <AppIcon name={icon} size={14} color={p.text} />}
      </Pressable>
    );
  }
}
