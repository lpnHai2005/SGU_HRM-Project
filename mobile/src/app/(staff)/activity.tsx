import { ManagerActivity } from '@/components/manager-activity';
import { useResource } from '@/hooks/use-resource';
import type { Profile } from '@/services/staff';
import { AppIcon, AppText as Text } from '@/components/app-icon';
import { storeLabel } from '@/services/presentation';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/contexts/session';
import {
  Button,
  Card,
  Input,
  Label,
  styles,
  usePalette,
  Badge,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import {
  ApiError,
  clockTime,
  request,
  scheduleLabels,
  vietnamPeriod,
  type Attendance,
} from '@/services/attendance';
import { statusLabels } from '@/services/staff';

function HistoryScreen() {
  const { token, ready, signOut } = useSession();
  const p = usePalette();
  const [period, setPeriod] = useState(vietnamPeriod);
  const [applied, setApplied] = useState(vietnamPeriod);
  const [rows, setRows] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Attendance | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const seq = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const data = await request<Attendance[]>(
        `/attendances/my-history?period=${encodeURIComponent(applied)}`,
        token
      );
      if (seq === sequence.current) setRows(data);
    } catch (e) {
      if (seq === sequence.current) {
        setRows([]);
        setError(e instanceof Error ? e.message : 'Không tải được lịch sử.');
      }
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [token, applied, signOut]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        sequence.current++;
      };
    }, [load])
  );

  if (ready && !token) return <Redirect href="/" />;

  return (
    <>
      {/* Detail sheet */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đóng chi tiết" onPress={() => setSelected(null)} style={{ flex: 1, backgroundColor: 'rgba(9,9,11,0.5)' }} />
        {selected && (
          <View style={{ backgroundColor: p.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: 1, borderColor: p.line, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 14 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: p.surfaceHigh, alignSelf: 'center' }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 16, color: p.text }}>Chi tiết lượt chấm công</Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, marginTop: 2 }}>
                  {selected.shift_name || 'Ca làm việc thực tế'} · <Text style={{ fontFamily: 'Mono', fontSize: 12, color: p.muted }}>{selected.work_date.split('-').reverse().join('/')}</Text> · {storeLabel(selected.store_name)}
                </Text>
              </View>
              <Badge
                label={statusLabels[selected.status] || 'Đã ghi nhận'}
                variant={['LATE', 'EARLY', 'LATE_AND_EARLY'].includes(selected.status) ? 'warning' : selected.check_out_time ? 'success' : 'info'}
                size="sm"
              />
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: p.line, borderRadius: 6 }}>
              {([
                ['Giờ vào', clockTime(selected.check_in_time)],
                ['Giờ ra', selected.check_out_time ? clockTime(selected.check_out_time) : '--:--'],
                ['Đi muộn / Về sớm', `${selected.late_minutes || 0}′ / ${selected.early_minutes || 0}′`],
                ['Tổng giờ công', `${Number(selected.actual_work_hours || 0).toFixed(2)}h`],
              ] as const).map(([k, v], i) => (
                <View key={k} style={{ width: '50%', padding: 12, borderLeftWidth: i % 2 ? 1 : 0, borderTopWidth: i > 1 ? 1 : 0, borderColor: p.line }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{k}</Text>
                  <Text style={{ fontFamily: 'MonoBold', fontSize: 15, color: p.text, marginTop: 3 }}>{v}</Text>
                </View>
              ))}
            </View>

            <View style={{ gap: 0 }}>
              {([
                ['Giờ ngoài ca ghi nhận', `+${selected.overtime_hours || 0}h`],
                ['Khung ca lúc vào', selected.attendance_context?.actual ? `${selected.attendance_context.actual.start_time.slice(0, 5)} – ${selected.attendance_context.actual.end_time.slice(0, 5)} · ${selected.attendance_context.actual.work_hours}h` : '—'],
                ['Đối soát lịch', scheduleLabels[selected.schedule_status] || 'Đã đối soát'],
              ] as const).map(([k, v], i, all) => (
                <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: i === all.length - 1 ? 0 : 1, borderBottomColor: p.line }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>{k}</Text>
                  <Text style={{ fontFamily: i < 2 ? 'MonoBold' : 'BeVietnamBold', fontSize: 13, color: p.text }}>{v}</Text>
                </View>
              ))}
            </View>
            <Button title="Đóng" secondary onPress={() => setSelected(null)} />
          </View>
        )}
      </Modal>

      {/* Main List */}
      <FlatList
        style={{ backgroundColor: p.bg }}
        contentContainerStyle={[styles.content, { gap: 8 }]}
        data={rows}
        keyExtractor={item => String(item.attendance_id)}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <LoadingBar active={loading} label="Đang tải lịch sử chấm công…" />
            <View style={{ gap: 6 }}>
              <Label variant="caption" muted>Tháng tra cứu (YYYY-MM)</Label>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Input
                    accessibilityLabel="Tháng tra cứu YYYY-MM"
                    placeholder="YYYY-MM"
                    value={period}
                    onChangeText={setPeriod}
                    keyboardType="numbers-and-punctuation"
                    maxLength={7}
                    leftIcon="calendar-outline"
                    style={{ fontFamily: 'Mono', paddingVertical: 11 }}
                  />
                </View>
                <Button
                  title="Lọc"
                  variant="secondary"
                  style={{ paddingVertical: 11 }}
                  onPress={() => {
                    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
                      setError('Vui lòng nhập định dạng năm-tháng hợp lệ (YYYY-MM).');
                    } else if (period === applied) {
                      void load();
                    } else {
                      setRows([]);
                      setApplied(period);
                    }
                  }}
                  disabled={loading}
                />
              </View>
            </View>

            {!!error && (
              <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
                <Text accessibilityRole="alert" style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>{error}</Text>
              </Card>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>
                Kỳ {applied.slice(5)}/{applied.slice(0, 4)}
              </Text>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                <Text style={{ fontFamily: 'MonoBold', fontSize: 12, color: p.text }}>{rows.length}</Text> lượt · <Text style={{ fontFamily: 'MonoBold', fontSize: 12, color: p.text }}>{new Set(rows.map(r => r.work_date)).size}</Text> ngày có mặt
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 6 }}>
              <View style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: p.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="clipboard-outline" size={20} color={p.muted} />
              </View>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>Chưa có lượt chấm công</Text>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, textAlign: 'center' }}>Chưa có dữ liệu chấm công cho tháng {applied}.</Text>
            </Card>
          ) : undefined
        }
        renderItem={({ item }) => {
          const working = !item.check_out_time;
          const late = ['LATE', 'EARLY', 'LATE_AND_EARLY'].includes(item.status);
          const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${item.work_date}T12:00:00Z`).getUTCDay()];
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Chi tiết lượt ngày ${item.work_date}`}
              onPress={() => setSelected(item)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: p.line, backgroundColor: pressed ? p.surfaceLow : p.card })}
            >
              <View style={{ width: 40, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'MonoBold', fontSize: 17, color: p.text }}>{item.work_date.slice(8, 10)}</Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 10, color: p.muted }}>{weekday}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>{item.shift_name || 'Ca làm việc'}</Text>
                  <Badge
                    label={working ? 'Đang làm' : late && item.late_minutes ? `Muộn ${item.late_minutes}′` : statusLabels[item.status] || 'Hoàn thành'}
                    variant={working ? 'info' : late ? 'warning' : 'success'}
                    size="sm"
                  />
                </View>
                <Text numberOfLines={1} style={{ fontFamily: 'Mono', fontSize: 12, color: p.body }}>
                  {clockTime(item.check_in_time)} → {item.check_out_time ? clockTime(item.check_out_time) : '--:--'}
                  {!working && ` · ${Number(item.actual_work_hours || 0).toFixed(1)}h`}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{storeLabel(item.store_name)}</Text>
              </View>
              <AppIcon name="chevron-forward" size={14} color={p.muted} />
            </Pressable>
          );
        }}
      />
    </>
  );
}
export default function ActivityScreen() {
 const {kind}=useLocalSearchParams<{kind?:string}>();
 const {data,error}=useResource<Profile>('/auth/me');
 if(!data)return <Label>{error||'Loading?'}</Label>;
 return data.roles?.some(r=>['ADMIN','HR_MANAGER','STORE_MANAGER'].includes(r))?<ManagerActivity key={kind||'all'} profile={data} initialKind={kind||'all'}/>:<HistoryScreen/>;
}
