import { LoadingBar } from '@/components/loading-bar';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, View, Text } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useSession } from '@/contexts/session';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { ApiError, displayTime, request, scheduleLabels, vietnamPeriod, type Attendance } from '@/services/attendance';
import { statusLabels } from '@/services/staff';

export default function HistoryScreen() {
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
    setLoading(true); setError('');
    try {
      const data = await request<Attendance[]>(`/attendances/my-history?period=${encodeURIComponent(applied)}`, token);
      if (seq === sequence.current) setRows(data);
    } catch (e) {
      if (seq === sequence.current) { setRows([]); setError(e instanceof Error ? e.message : 'Không tải được lịch sử.'); }
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally { if (seq === sequence.current) setLoading(false); }
  }, [token, applied, signOut]);
  useFocusEffect(useCallback(() => { void load(); return () => { sequence.current++; }; }, [load]));
  if (ready && !token) return <Redirect href="/" />;
  return <><Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}><ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={[styles.content, { paddingTop: 56 }]}><Label large>Chi tiết chấm công</Label>{selected && <Card>
      <Label>{selected.work_date} · {selected.shift_name || 'Ca thực tế'}</Label><Label>{selected.store_name || 'Cửa hàng'}</Label>
      {selected.attendance_context?.actual && <Label muted>Ca đã lưu: {selected.attendance_context.actual.start_time.slice(0,5)}–{selected.attendance_context.actual.end_time.slice(0,5)} · Chuẩn {selected.attendance_context.actual.work_hours} giờ</Label>}
      <Label>Vào: {displayTime(selected.check_in_time)}</Label><Label>Ra: {displayTime(selected.check_out_time)}</Label><Label>Giờ công: {Number(selected.actual_work_hours || 0).toFixed(2)}</Label>
      <Label>Muộn {selected.late_minutes || 0} phút · Sớm {selected.early_minutes || 0} phút</Label><Label>OT: {selected.overtime_hours || 0} giờ</Label><Label>{statusLabels[selected.status] || 'Chưa xác định'}</Label><Label muted>{scheduleLabels[selected.schedule_status] || 'Chưa đối chiếu'}</Label>
    </Card>}<Button title="Đóng chi tiết" onPress={() => setSelected(null)} /></ScrollView></Modal><FlatList style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content} data={rows} keyExtractor={item => String(item.attendance_id)} refreshing={loading} onRefresh={load}
    ListHeaderComponent={<View style={{ gap: 14 }}><LoadingBar active={loading} /><Label large>Nhật ký làm việc</Label><Label muted>Từng lượt độc lập · Giờ Việt Nam · {applied}</Label>
      <Input accessibilityLabel="Tháng tra cứu YYYY-MM" placeholder="YYYY-MM" value={period} onChangeText={setPeriod} keyboardType="numbers-and-punctuation" maxLength={7} />
      <Button title="Tra cứu tháng" onPress={() => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) setError('Nhập tháng theo YYYY-MM.'); else if (period === applied) void load(); else { setRows([]); setApplied(period); } }} disabled={loading} />
      {!!error && <Text accessibilityRole="alert" style={{ color: p.danger }}>{error}</Text>}
      <Label>{rows.length} lượt · {new Set(rows.map(r => r.work_date)).size} ngày có mặt</Label></View>}
    ListEmptyComponent={!loading && !error ? <Card><Label>Chưa có lượt chấm công trong tháng này.</Label></Card> : null}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Chi tiết lượt ngày ${item.work_date}`} onPress={() => setSelected(item)}><Card><Label>{item.work_date}</Label><Label>{item.shift_name || 'Ca làm việc'}</Label><Label muted>{scheduleLabels[item.schedule_status] || 'Chưa đối chiếu'}</Label>
      <Label>Vào {displayTime(item.check_in_time)} · Ra {displayTime(item.check_out_time)}</Label>
      <Label>{item.check_out_time ? 'Đã đóng lượt' : 'Đang làm việc'} · {Number(item.actual_work_hours || 0).toFixed(2)} giờ</Label>
      <Label muted>Muộn {item.late_minutes || 0} phút · Sớm {item.early_minutes || 0} phút · OT {item.overtime_hours || 0} giờ</Label>
      <Label muted>{statusLabels[item.status] || 'Chưa xác định'} · Xem chi tiết →</Label>
    </Card></Pressable>} /></>;
}
