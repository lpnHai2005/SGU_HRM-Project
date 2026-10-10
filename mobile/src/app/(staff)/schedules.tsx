import { AppText as Text } from '@/components/app-icon';
import { storeLabel } from '@/services/presentation';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import {
  Button,
  Card,
  Label,
  styles,
  usePalette,
  Badge,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { vietnamPeriod } from '@/services/attendance';
import type { Schedule } from '@/services/staff';

export default function Schedules() {
  const p = usePalette();
  const [applied, setApplied] = useState(vietnamPeriod);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(() => Number(vietnamPeriod().slice(0, 4)));
  const [draftMonth, setDraftMonth] = useState(() => Number(vietnamPeriod().slice(5, 7)));
  const { data, error, loading } = useResource<Schedule[]>(
    `/mobile-attendance/my-schedules?period=${applied}`
  );
  const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const selectedMonthLabel = `${monthNames[Number(applied.slice(5, 7)) - 1]} / ${applied.slice(0, 4)}`;

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label variant="title">Lịch ca & Phân công</Label>
          <Badge label={`Kỳ ${applied}`} variant="brand" />
        </View>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
          Lịch làm việc đã được quản lý phê duyệt theo tuần
        </Text>
      </View>

      <Card low style={{ gap: 10 }}>
        <Label variant="caption">Chọn tháng tra cứu</Label>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Chọn tháng lịch, hiện tại ${selectedMonthLabel}`}
          onPress={() => {
            setDraftYear(Number(applied.slice(0, 4)));
            setDraftMonth(Number(applied.slice(5, 7)));
            setMonthPickerOpen(true);
          }}
          style={{
            minHeight: 50,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: p.line,
            backgroundColor: p.surfaceLow,
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 15, color: p.text }}>🗓️  {selectedMonthLabel}</Text>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.brandText }}>Đổi tháng</Text>
        </Pressable>
      </Card>

      <LoadingBar active={loading} label="Đang tải danh sách ca làm việc…" />

      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
            ⚠️ {error}
          </Text>
        </Card>
      )}

      {data?.map(s => {
        const storeName = storeLabel(s.store_name);
        return (
          <Card key={s.schedule_id} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, fontWeight: '700', color: p.text }}>
                {s.work_date.split('-').reverse().join('/')}
              </Text>
              <Badge label="Đã xếp ca" variant="success" size="sm" />
            </View>

            <View style={{ gap: 4 }}>
              <Label variant="subtitle">{s.shift_name}</Label>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.brandText }}>
                ⏱️ {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
              </Text>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                🏪 {storeName}
              </Text>
            </View>
          </Card>
        );
      })}

      {data?.length === 0 && !loading && (
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Text style={{ fontSize: 28, marginBottom: 8 }}>📅</Text>
          <Label variant="subtitle">Chưa có lịch phân ca</Label>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, textAlign: 'center', marginTop: 4 }}>
            Tháng {applied} chưa có phân ca cụ thể. Bạn vẫn có thể chọn ca thực tế khi chấm công để đối soát.
          </Text>
        </Card>
      )}

      <Modal
        visible={monthPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthPickerOpen(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Đóng chọn tháng"
          onPress={() => setMonthPickerOpen(false)}
          style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.55)' }}
        >
          <Pressable
            onPress={event => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              alignSelf: 'center',
              borderRadius: 20,
              padding: 20,
              gap: 18,
              backgroundColor: p.card,
              borderWidth: 1,
              borderColor: p.line,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label variant="subtitle">Chọn tháng tra cứu</Label>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Năm trước" hitSlop={8} onPress={() => setDraftYear(year => year - 1)}>
                  <Text style={{ color: p.brandText, fontSize: 24, fontFamily: 'BeVietnamBold' }}>‹</Text>
                </Pressable>
                <Text style={{ color: p.text, fontSize: 16, fontFamily: 'BeVietnamBold' }}>{draftYear}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Năm sau" hitSlop={8} onPress={() => setDraftYear(year => year + 1)}>
                  <Text style={{ color: p.brandText, fontSize: 24, fontFamily: 'BeVietnamBold' }}>›</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {monthNames.map((month, index) => {
                const monthNumber = index + 1;
                const selected = draftMonth === monthNumber;
                return (
                  <Pressable
                    key={month}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setDraftMonth(monthNumber)}
                    style={{
                      width: '31%',
                      minHeight: 46,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: selected ? p.brand : p.line,
                      backgroundColor: selected ? p.brandLight : p.surfaceLow,
                    }}
                  >
                    <Text style={{ color: selected ? p.brandText : p.text, fontFamily: 'BeVietnam', fontSize: 13 }}>
                      {month}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <Button title="Đóng" variant="secondary" onPress={() => setMonthPickerOpen(false)} />
              <Button
                title="Xem lịch"
                variant="brand"
                onPress={() => {
                  const nextPeriod = `${draftYear}-${String(draftMonth).padStart(2, '0')}`;
                  setApplied(nextPeriod);
                  setMonthPickerOpen(false);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
