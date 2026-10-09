import { AppText as Text } from '@/components/app-icon';
import { storeLabel } from '@/services/presentation';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
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
  displayTime,
  request,
  scheduleLabels,
  vietnamPeriod,
  type Attendance,
} from '@/services/attendance';
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
      {/* Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <ScrollView
          style={{ backgroundColor: p.bg }}
          contentContainerStyle={[styles.content, { paddingTop: 48 }]}
        >
          <Label variant="title">Chi tiết lượt chấm công</Label>
          {selected && (
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Badge
                  label={statusLabels[selected.status] || 'Đã ghi nhận'}
                  variant={
                    selected.status === 'VALID' || selected.status === 'APPROVED'
                      ? 'success'
                      : selected.status === 'LATE' || selected.status === 'EARLY'
                      ? 'warning'
                      : 'neutral'
                  }
                />
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                  {selected.work_date}
                </Text>
              </View>

              <View style={{ gap: 4 }}>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 16, fontWeight: '700', color: p.text }}>
                  {selected.shift_name || 'Ca làm việc thực tế'}
                </Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.brand }}>
                  🏪 {storeLabel(selected.store_name)}
                </Text>
              </View>

              {selected.attendance_context?.actual && (
                <View
                  style={{
                    backgroundColor: p.surfaceLow,
                    padding: 12,
                    borderRadius: 10,
                    gap: 4,
                  }}
                >
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.text }}>
                    Bản chụp ca lúc check-in:
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                    Khung giờ: {selected.attendance_context.actual.start_time.slice(0, 5)} –{' '}
                    {selected.attendance_context.actual.end_time.slice(0, 5)} • Chuẩn{' '}
                    {selected.attendance_context.actual.work_hours} giờ
                  </Text>
                </View>
              )}

              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Giờ vào:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                    {displayTime(selected.check_in_time)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Giờ ra:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                    {displayTime(selected.check_out_time)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Tổng giờ công:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.emeraldText }}>
                    {Number(selected.actual_work_hours || 0).toFixed(2)} giờ
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Đi muộn / Về sớm:</Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                    Muộn {selected.late_minutes || 0}m • Sớm {selected.early_minutes || 0}m
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Giờ OT phê duyệt:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.brandText }}>
                    +{selected.overtime_hours || 0} giờ
                  </Text>
                </View>
              </View>

              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                Đối soát lịch: {scheduleLabels[selected.schedule_status] || 'Đã đối soát'}
              </Text>
            </Card>
          )}
          <Button title="Đóng chi tiết" secondary onPress={() => setSelected(null)} />
        </ScrollView>
      </Modal>

      {/* Main List */}
      <FlatList
        style={{ backgroundColor: p.bg }}
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={item => String(item.attendance_id)}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          <View style={{ gap: 14 }}>
            <LoadingBar active={loading} label="Đang tải lịch sử chấm công…" />
            <View style={{ gap: 4 }}>
              <Label variant="title">Nhật ký làm việc</Label>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                Từng ca độc lập • Thời gian thực • Kỳ {applied}
              </Text>
            </View>

            <Card low style={{ gap: 10 }}>
              <Label variant="caption">Bộ lọc tháng tra cứu (YYYY-MM)</Label>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Input
                    accessibilityLabel="Tháng tra cứu YYYY-MM"
                    placeholder="YYYY-MM"
                    value={period}
                    onChangeText={setPeriod}
                    keyboardType="numbers-and-punctuation"
                    maxLength={7}
                    leftIcon="🗓️"
                  />
                </View>
                <Button
                  title="Lọc"
                  variant="brand"
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
            </Card>

            {!!error && (
              <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
                <Text accessibilityRole="alert" style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
                  ⚠️ {error}
                </Text>
              </Card>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                {rows.length} lượt chấm công
              </Text>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                {new Set(rows.map(r => r.work_date)).size} ngày có mặt
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
              <Text style={{ fontSize: 28, marginBottom: 8 }}>📋</Text>
              <Label variant="subtitle">Chưa có lượt chấm công</Label>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, textAlign: 'center', marginTop: 4 }}>
                Chưa có dữ liệu chấm công cho tháng {applied}.
              </Text>
            </Card>
          ) : null
        }
        renderItem={({ item }) => {
          const storeName = storeLabel(item.store_name);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Chi tiết lượt ngày ${item.work_date}`}
              onPress={() => setSelected(item)}
            >
              <Card style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, fontWeight: '700', color: p.text }}>
                    {item.work_date}
                  </Text>
                  <Badge
                    label={statusLabels[item.status] || (item.check_out_time ? 'Hoàn thành' : 'Đang làm')}
                    variant={item.check_out_time ? 'success' : 'brand'}
                    size="sm"
                  />
                </View>

                <View style={{ gap: 2 }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                    {item.shift_name || 'Ca làm việc'} • {storeName}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                    Vào {displayTime(item.check_in_time)} → Ra {displayTime(item.check_out_time)}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.emeraldText }}>
                    {Number(item.actual_work_hours || 0).toFixed(2)} giờ công
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.brand }}>
                    Xem chi tiết ›
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </>
  );
}
