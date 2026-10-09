import { AppText as Text } from '@/components/app-icon';
import { storeLabel } from '@/services/presentation';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
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
import { useResource } from '@/hooks/use-resource';
import { vietnamPeriod } from '@/services/attendance';
import type { Schedule } from '@/services/staff';

export default function Schedules() {
  const p = usePalette();
  const [period, setPeriod] = useState(vietnamPeriod);
  const [applied, setApplied] = useState(vietnamPeriod);
  const [invalid, setInvalid] = useState('');
  const { data, error, loading, reload } = useResource<Schedule[]>(
    `/mobile-attendance/my-schedules?period=${applied}`
  );

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
        <Label variant="caption">Chọn tháng tra cứu (YYYY-MM)</Label>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input
              value={period}
              onChangeText={setPeriod}
              placeholder="YYYY-MM"
              accessibilityLabel="Tháng lịch biểu"
              leftIcon="🗓️"
            />
          </View>
          <Button
            title="Xem lịch"
            variant="brand"
            onPress={() => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
                setInvalid('');
                setApplied(period);
                reload();
              } else {
                setInvalid('Vui lòng nhập định dạng YYYY-MM.');
              }
            }}
          />
        </View>
      </Card>

      <LoadingBar active={loading} label="Đang tải danh sách ca làm việc…" />

      {!!(error || invalid) && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
            ⚠️ {error || invalid}
          </Text>
        </Card>
      )}

      {data?.map(s => {
        const storeName = storeLabel(s.store_name);
        return (
          <Card key={s.schedule_id} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, fontWeight: '700', color: p.text }}>
                {s.work_date}
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
    </ScrollView>
  );
}
