import { AppText as Text } from '@/components/app-icon';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
  MetricBox,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { ApiError, request, vietnamPeriod } from '@/services/attendance';

type Summary = {
  employee_name: string;
  working_days: { actual_days: number; standard_days: number; total_hours: number };
  leave_quota: { annual_leave: number; used_leave: number; remaining_leave: number };
  late_arrivals: { count: number; minutes: number };
  early_departures: { count: number; minutes: number };
  overtime: { shifts_count: number; hours: number };
  extra_work: { hours?: number };
  business_trips: { days?: number };
  compensatory_leave: { total?: number };
};

export default function SummaryScreen() {
  const { token, ready, signOut } = useSession();
  const p = usePalette();
  const [period, setPeriod] = useState(vietnamPeriod);
  const [query, setQuery] = useState(() => ({ period: vietnamPeriod() }));
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let active = true;
      setBusy(true);
      setError('');
      setData(null);
      request<Summary>(`/attendances/my-summary?period=${query.period}`, token)
        .then(value => {
          if (active) setData(value);
        })
        .catch(e => {
          if (active) setError(e instanceof Error ? e.message : 'Không tải được bảng công.');
          if (e instanceof ApiError && e.status === 401) void signOut();
        })
        .finally(() => {
          if (active) setBusy(false);
        });
      return () => {
        active = false;
      };
    }, [token, query, signOut])
  );

  if (ready && !token) return <Redirect href="/" />;

  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Title & Month Badge */}
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label variant="title">Bảng công cá nhân</Label>
          <Badge label={`Tháng ${query.period.slice(5)}/${query.period.slice(0, 4)}`} variant="brand" />
        </View>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
          Nhân viên: <Text style={{ fontFamily: 'BeVietnamBold', color: p.text }}>{data?.employee_name || 'TechZone Staff'}</Text>
        </Text>
      </View>

      {/* Month Query Filter */}
      <Card low style={{ gap: 10 }}>
        <Label variant="caption">Tra cứu kỳ công (Định dạng YYYY-MM)</Label>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input
              accessibilityLabel="Tháng YYYY-MM"
              value={period}
              onChangeText={setPeriod}
              placeholder="YYYY-MM"
              maxLength={7}
              leftIcon="🗓️"
            />
          </View>
          <Button
            title="Tra cứu"
            variant="brand"
            disabled={busy}
            onPress={() => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) setQuery({ period });
              else setError('Vui lòng nhập định dạng năm-tháng hợp lệ (VD: 2026-10).');
            }}
          />
        </View>
      </Card>

      <LoadingBar active={busy} label="Đang đối chiếu dữ liệu bảng công từ máy chủ…" />

      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text accessibilityRole="alert" style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
            ⚠️ {error}
          </Text>
        </Card>
      )}

      {/* Core 4 Metrics (Grid 2x2) */}
      {data && (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricBox
              label="Ngày công thực tế"
              value={`${data.working_days.actual_days} / ${data.working_days.standard_days}`}
              subtext={`${data.working_days.total_hours} giờ làm việc`}
              icon="💼"
              variant="brand"
            />
            <MetricBox
              label="Quỹ phép năm"
              value={`${data.leave_quota.remaining_leave} ngày`}
              subtext={`Đã dùng ${data.leave_quota.used_leave}/${data.leave_quota.annual_leave} ngày`}
              icon="🏖️"
              variant="success"
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricBox
              label="Tăng ca (OT)"
              value={`+${data.overtime.hours}h`}
              subtext={`${data.overtime.shifts_count} ca làm thêm`}
              icon="⚡"
              variant="brand"
            />
            <MetricBox
              label="Đi muộn"
              value={`${data.late_arrivals.count} lần`}
              subtext={`Tổng ${data.late_arrivals.minutes} phút`}
              icon="⏱️"
              variant={data.late_arrivals.count ? 'warning' : 'neutral'}
            />
          </View>

          {/* Secondary Metrics */}
          <Card style={{ gap: 10 }}>
            <Label variant="subtitle">Chỉ số công tác & nghỉ bù</Label>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Về sớm quy chuẩn:</Text>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                {data.early_departures.count} lần ({data.early_departures.minutes} phút)
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: p.line }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Công tác ngoài Showroom:</Text>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                {data.business_trips.days ?? 0} ngày
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: p.line }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Nghỉ bù tích lũy:</Text>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                {data.compensatory_leave.total ?? 0} ngày
              </Text>
            </View>
          </Card>
        </>
      )}

      {/* Rules Card */}
      <Card low style={{ gap: 10 }}>
        <Label variant="subtitle">Quy định chấm công & tính lương</Label>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, lineHeight: 18 }}>
          • Thời gian bắt đầu tính muộn: Sau mốc bắt đầu ca quá 15 phút.
        </Text>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, lineHeight: 18 }}>
          • Ca chưa phân công trước vẫn được máy chủ ghi nhận đối soát đầy đủ.
        </Text>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, lineHeight: 18 }}>
          • Giờ công và giờ tăng ca OT được tính theo bản chụp ca lúc check-in thực tế.
        </Text>
      </Card>
    </ScrollView>
  );
}
