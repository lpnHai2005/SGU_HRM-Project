import { AppIcon, AppText as Text } from '@/components/app-icon';
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
  MetricBox,
  ProgressBar,
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
      automaticallyAdjustKeyboardInsets
    >
      {/* Period lookup */}
      <View style={{ gap: 6 }}>
        <Label variant="caption" muted>Kỳ công (YYYY-MM){data?.employee_name ? ` · ${data.employee_name}` : ''}</Label>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input
              accessibilityLabel="Tháng YYYY-MM"
              value={period}
              onChangeText={setPeriod}
              placeholder="YYYY-MM"
              maxLength={7}
              leftIcon="calendar-outline"
              style={{ fontFamily: 'Mono', paddingVertical: 11 }}
            />
          </View>
          <Button
            title="Tra cứu"
            variant="brand"
            disabled={busy}
            style={{ paddingVertical: 11 }}
            onPress={() => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) setQuery({ period });
              else setError('Vui lòng nhập định dạng năm-tháng hợp lệ (VD: 2026-10).');
            }}
          />
        </View>
      </View>
      <LoadingBar active={busy} label="Đang đối chiếu dữ liệu bảng công từ máy chủ…" />

      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text accessibilityRole="alert" style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
            <AppIcon name="warning-outline" size={14} /> {error}
          </Text>
        </Card>
      )}

      {data && (() => {
        const pct = Math.min(100, Math.round((data.working_days.actual_days / (data.working_days.standard_days || 26)) * 100));
        const leavePct = data.leave_quota.annual_leave ? Math.min(100, (data.leave_quota.remaining_leave / data.leave_quota.annual_leave) * 100) : 0;
        const kv: [string, string][] = [
          ['Về sớm quy chuẩn', `${data.early_departures.count} lần · ${data.early_departures.minutes} phút`],
          ['Công tác ngoài Showroom', `${data.business_trips?.days ?? 0} ngày`],
          ['Nghỉ bù tích lũy', `${data.compensatory_leave?.total ?? 0} ngày`],
        ];
        return (
          <>
            <Card style={{ gap: 10 }}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>
                Ngày công thực tế · {query.period.slice(5)}/{query.period.slice(0, 4)}
              </Text>
              <Text style={{ fontFamily: 'MonoBold', fontSize: 36, lineHeight: 42, letterSpacing: -1, color: p.text }}>
                {data.working_days.actual_days}
                <Text style={{ fontFamily: 'Mono', fontSize: 16, color: p.muted, letterSpacing: 0 }}> / {data.working_days.standard_days}</Text>
              </Text>
              <ProgressBar progress={pct} color={p.text} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.emeraldText }}>Đạt {pct}% ngày công chuẩn</Text>
                <Text style={{ fontFamily: 'Mono', fontSize: 12, color: p.muted }}>{data.working_days.total_hours}h</Text>
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricBox
                label="Đi muộn"
                value={`${data.late_arrivals.count} lần`}
                subtext={data.late_arrivals.minutes ? `⚠ Tổng ${data.late_arrivals.minutes} phút` : 'Đúng giờ'}
                variant={data.late_arrivals.count ? 'warning' : 'neutral'}
              />
              <MetricBox
                label="Giờ ngoài ca ghi nhận"
                value={`${data.overtime.hours}h`}
                subtext={`${data.overtime.shifts_count} phiên · chưa phải OT đã duyệt`}
              />
            </View>

            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.body }}>Quỹ phép năm còn lại</Text>
                <Text style={{ fontFamily: 'MonoBold', fontSize: 14, color: p.text }}>
                  {data.leave_quota.remaining_leave}<Text style={{ fontFamily: 'Mono', fontSize: 12, color: p.muted }}> / {data.leave_quota.annual_leave} ngày</Text>
                </Text>
              </View>
              <ProgressBar progress={leavePct} color={p.emerald} />
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Đã dùng {data.leave_quota.used_leave} ngày</Text>
            </Card>

            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>Chỉ số công tác & nghỉ bù</Text>
              <Card style={{ padding: 0, gap: 0 }}>
                {kv.map(([k, v], i) => (
                  <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i === kv.length - 1 ? 0 : 1, borderBottomColor: p.line }}>
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>{k}</Text>
                    <Text style={{ fontFamily: 'MonoBold', fontSize: 13, color: p.text }}>{v}</Text>
                  </View>
                ))}
              </Card>
            </View>
          </>
        );
      })()}

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
          • Giờ ngoài ca được ghi nhận theo phiên chấm công và bản chụp ca. Đây chưa phải OT được HR duyệt và không tự được tính lương.
        </Text>
      </Card>
    </ScrollView>
  );
}
