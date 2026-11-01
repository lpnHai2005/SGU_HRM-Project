import { ManagerSchedules } from '@/components/manager-schedules';
import { AppIcon, AppText as Text } from '@/components/app-icon';
import { storeLabel } from '@/services/presentation';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, styles, usePalette, Badge } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { vietnamPeriod } from '@/services/attendance';
import type { Schedule, Profile } from '@/services/staff';

const TZ = 'Asia/Ho_Chi_Minh';
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function shiftHours(s: Schedule) {
  const [sh, sm] = s.start_time.split(':').map(Number);
  const [eh, em] = s.end_time.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60; // overnight shift
  return minutes / 60;
}

/** Monday of the week containing an ISO date (YYYY-MM-DD), as YYYY-MM-DD. */
function weekStart(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function MonthSheet({ period, onClose, onApply }: { period: string; onClose: () => void; onApply: (period: string) => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(Number(period.slice(0, 4)));
  const [month, setMonth] = useState(Number(period.slice(5, 7)));
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Đóng chọn tháng" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(9,9,11,0.5)' }} />
      <View style={{ backgroundColor: p.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: 1, borderColor: p.line, padding: 16, paddingBottom: insets.bottom + 20, gap: 16 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: p.surfaceHigh, alignSelf: 'center' }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 16, color: p.text }}>Chọn tháng tra cứu</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Năm trước" onPress={() => setYear(y => y - 1)} style={{ width: 36, height: 36, borderRadius: 6, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="chevron-back" size={16} color={p.text} />
            </Pressable>
            <Text style={{ fontFamily: 'MonoBold', fontSize: 14, color: p.text, paddingHorizontal: 8 }}>{year}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Năm sau" onPress={() => setYear(y => y + 1)} style={{ width: 36, height: 36, borderRadius: 6, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="chevron-forward" size={16} color={p.text} />
            </Pressable>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Array.from({ length: 12 }, (_, i) => {
            const selected = month === i + 1;
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setMonth(i + 1)}
                style={{ width: '31.5%', height: 48, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderColor: selected ? p.brand : p.line, backgroundColor: selected ? p.brand : p.card }}
              >
                <Text style={{ fontFamily: selected ? 'BeVietnamBold' : 'BeVietnam', fontSize: 13, color: selected ? p.onBrand : p.text }}>Tháng {i + 1}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Đóng" secondary style={{ flex: 1 }} onPress={onClose} />
          <Button title={`Xem lịch ${String(month).padStart(2, '0')}/${year}`} style={{ flex: 2 }} onPress={() => onApply(`${year}-${String(month).padStart(2, '0')}`)} />
        </View>
      </View>
    </Modal>
  );
}

function PersonalSchedules({ period }: { period: string }) {
  const p = usePalette();
  const { data, error, loading } = useResource<Schedule[]>(`/mobile-attendance/my-schedules?period=${period}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const rows = [...(data || [])].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time));
  const daysInMonth = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate();
  const totalHours = rows.reduce((sum, s) => sum + shiftHours(s), 0);
  const offDays = daysInMonth - new Set(rows.map(s => s.work_date)).size;
  const weeks = new Map<string, Schedule[]>();
  for (const s of rows) {
    const key = weekStart(s.work_date);
    weeks.set(key, [...(weeks.get(key) || []), s]);
  }

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stat label="Đã xếp ca" value={String(rows.length)} />
        <Stat label="Tổng giờ" value={`${Number(totalHours.toFixed(1))}h`} />
        <Stat label="Ngày nghỉ" value={String(offDays)} />
      </View>

      <LoadingBar active={loading} label="Đang tải danh sách ca làm việc…" />
      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>{error}</Text>
        </Card>
      )}

      {[...weeks.entries()].map(([monday, list]) => {
        const sunday = new Date(`${monday}T12:00:00Z`);
        sunday.setUTCDate(sunday.getUTCDate() + 6);
        return (
          <View key={monday} style={{ gap: 8 }}>
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>
              Tuần {dm(monday)} – {dm(sunday.toISOString().slice(0, 10))}
            </Text>
            <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
              {list.map((s, i) => {
                const isToday = s.work_date === today;
                const past = s.work_date < today;
                const weekday = WEEKDAYS[new Date(`${s.work_date}T12:00:00Z`).getUTCDay()];
                return (
                  <View key={s.schedule_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: p.line, backgroundColor: isToday ? p.surfaceLow : 'transparent' }}>
                    <View style={{ width: 44, paddingVertical: 4, borderRadius: 6, alignItems: 'center', backgroundColor: isToday ? p.brand : 'transparent' }}>
                      <Text style={{ fontFamily: 'BeVietnam', fontSize: 10, color: isToday ? p.onBrand : p.muted }}>{weekday}</Text>
                      <Text style={{ fontFamily: 'MonoBold', fontSize: 17, color: isToday ? p.onBrand : past ? p.muted : p.text }}>{s.work_date.slice(8, 10)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>{s.shift_name}</Text>
                      <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, marginTop: 2 }}>
                        <Text style={{ fontFamily: 'Mono', fontSize: 12, color: p.body }}>{s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}</Text> · {storeLabel(s.store_name)}
                      </Text>
                    </View>
                    {isToday ? <Badge label="Hôm nay" variant="info" pulse size="sm" /> : past ? <Badge label="Đã qua" size="sm" /> : <Badge label="Sắp tới" variant="brand" size="sm" />}
                  </View>
                );
              })}
            </Card>
          </View>
        );
      })}

      {data?.length === 0 && !loading && (
        <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 6 }}>
          <View style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: p.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name="calendar-outline" size={20} color={p.muted} />
          </View>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>Chưa có lịch phân ca</Text>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, textAlign: 'center' }}>
            Tháng {period.slice(5)}/{period.slice(0, 4)} chưa có phân ca cụ thể. Bạn vẫn có thể chọn ca thực tế khi chấm công để đối soát.
          </Text>
        </Card>
      )}
    </ScrollView>
  );

  function Stat({ label, value }: { label: string; value: string }) {
    return (
      <Card style={{ flex: 1, padding: 12, gap: 4 }}>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{label}</Text>
        <Text style={{ fontFamily: 'MonoBold', fontSize: 20, color: p.text }}>{value}</Text>
      </Card>
    );
  }
}

export default function Schedules() {
  const { data } = useResource<Profile>('/auth/me');
  const [tab, setTab] = useState<'personal' | 'team'>('personal');
  const [period, setPeriod] = useState(vietnamPeriod);
  const [picking, setPicking] = useState(false);
  const manager = data?.roles?.some(r => ['ADMIN', 'HR_MANAGER', 'STORE_MANAGER'].includes(r));
  const p = usePalette();
  const team = manager && tab === 'team';

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: p.card, borderBottomWidth: 1, borderBottomColor: p.line }}>
        {manager ? (
          <View accessibilityRole="tablist" style={{ flex: 1, flexDirection: 'row', gap: 4, padding: 3, borderRadius: 6, backgroundColor: p.surfaceLow }}>
            {(['personal', 'team'] as const).map(key => {
              const active = tab === key;
              return (
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setTab(key)} style={{ flex: 1, height: 34, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? p.line : 'transparent', backgroundColor: active ? p.card : 'transparent' }}>
                  <Text style={{ fontFamily: active ? 'BeVietnamBold' : 'BeVietnam', fontSize: 13, color: active ? p.text : p.muted }}>{key === 'personal' ? 'Cá nhân' : 'Nhân viên'}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={{ flex: 1, fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Lịch đã được quản lý phê duyệt</Text>
        )}
        {!team && (
          <Pressable accessibilityRole="button" accessibilityLabel={`Đổi tháng, đang xem ${period}`} onPress={() => setPicking(true)} style={{ height: 40, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line, backgroundColor: p.card, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: 'MonoBold', fontSize: 13, color: p.text }}>{period.slice(5)}/{period.slice(0, 4)}</Text>
            <AppIcon name="chevron-down" size={14} color={p.muted} />
          </Pressable>
        )}
      </View>
      {team ? <ManagerSchedules profile={data!} /> : <PersonalSchedules period={period} />}
      {picking && <MonthSheet period={period} onClose={() => setPicking(false)} onApply={next => { setPeriod(next); setPicking(false); }} />}
    </View>
  );
}
