import { useState } from 'react';
import { View, ScrollView, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { AppText as Text } from '@/components/app-icon';
import { usePalette, Card, Label, Badge } from '@/components/attendance-ui';
import { formatVND, type AttendanceHistoryRecord, type PayrollUnitItem } from '@/services/dashboard';
import { displayTime } from '@/services/attendance';

// ===================================================================================
// 1. BIỂU ĐỒ CỘT GIỜ LÀM VIỆC THEO NGÀY (DAILY WORK HOURS BAR CHART)
// ===================================================================================

export function DailyHoursBarChart({
  records,
  period,
}: {
  records: AttendanceHistoryRecord[];
  period: string;
}) {
  const p = usePalette();
  const [selectedRecord, setSelectedRecord] = useState<AttendanceHistoryRecord | null>(null);

  // Sort records ascending by work_date
  const sorted = [...records].sort((a, b) => a.work_date.localeCompare(b.work_date));

  // Determine max hours to scale (benchmark 8h, or max found)
  const maxHours = Math.max(10, ...sorted.map(r => r.actual_work_hours || 0));
  const chartHeight = 130;

  if (sorted.length === 0) {
    return (
      <Card low style={{ alignItems: 'center', paddingVertical: 24, gap: 6 }}>
        <Text style={{ fontSize: 28 }}>📊</Text>
        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
          Chưa có dữ liệu chấm công kỳ {period}
        </Text>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted, textAlign: 'center' }}>
          Các ngày có ghi nhận check-in/check-out sẽ xuất hiện dạng biểu đồ cột tại đây.
        </Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {/* Selected tooltip banner */}
      {selectedRecord && (
        <View
          style={{
            backgroundColor: p.surfaceLow,
            borderRadius: 12,
            padding: 10,
            borderWidth: 1,
            borderColor: p.brand,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.brandText }}>
              📅 Ngày {selectedRecord.work_date.slice(8)}/{selectedRecord.work_date.slice(5, 7)} ({selectedRecord.shift_name || 'Ca thường'})
            </Text>
            <Pressable onPress={() => setSelectedRecord(null)}>
              <Text style={{ fontSize: 12, color: p.muted }}>✕ Đóng</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.body }}>
              Thời gian: {displayTime(selectedRecord.check_in_time)} → {displayTime(selectedRecord.check_out_time)}
            </Text>
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: p.emeraldText }}>
              {selectedRecord.actual_work_hours} giờ
            </Text>
          </View>
          {selectedRecord.late_minutes > 0 && (
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.amberText }}>
              ⚠️ Đi muộn: {selectedRecord.late_minutes} phút
            </Text>
          )}
        </View>
      )}

      {/* Target reference line indicator */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
          Chạm cột để xem chi tiết • Mục tiêu ca chuẩn: 8.0h
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 2, backgroundColor: p.line }} />
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 10, color: p.muted }}>8h</Text>
        </View>
      </View>

      {/* Scrollable Bar Chart Canvas */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 6, paddingHorizontal: 2 }}
      >
        {sorted.map(item => {
          const hours = Number(item.actual_work_hours) || 0;
          const barHeight = Math.max(6, Math.min(chartHeight, (hours / maxHours) * chartHeight));
          const isSelected = selectedRecord?.attendance_id === item.attendance_id;
          const isLate = item.late_minutes > 0;

          // Color coding
          let barColor = p.brand;
          if (hours >= 8) barColor = p.emerald;
          else if (isLate || hours < 4) barColor = p.amber;

          const dayLabel = item.work_date.slice(8);

          return (
            <Pressable
              key={item.attendance_id || item.work_date}
              accessibilityRole="button"
              accessibilityLabel={`Ngày ${dayLabel}: ${hours} giờ`}
              onPress={() => setSelectedRecord(item)}
              style={{
                alignItems: 'center',
                width: 32,
                justifyContent: 'flex-end',
                height: chartHeight + 28,
              }}
            >
              {/* Hours label on top of bar */}
              <Text
                style={{
                  fontFamily: 'BeVietnamBold',
                  fontSize: 9,
                  color: isSelected ? p.brand : p.muted,
                  marginBottom: 2,
                }}
              >
                {hours > 0 ? hours.toFixed(1) : '0'}
              </Text>

              {/* The Bar */}
              <View
                style={{
                  width: 18,
                  height: barHeight,
                  backgroundColor: barColor,
                  borderRadius: 6,
                  borderWidth: isSelected ? 2 : 0,
                  borderColor: isSelected ? p.text : 'transparent',
                  opacity: selectedRecord && !isSelected ? 0.45 : 1,
                  shadowColor: barColor,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: isSelected ? 0.4 : 0.15,
                  shadowRadius: 3,
                  elevation: isSelected ? 3 : 1,
                }}
              />

              {/* Day of Month label */}
              <Text
                style={{
                  fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                  fontSize: 10,
                  color: isSelected ? p.brand : p.text,
                  marginTop: 6,
                }}
              >
                {dayLabel}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Legend below bar chart */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.emerald }} />
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Đạt chuẩn (≥8h)</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.brand }} />
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Đang tích lũy</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.amber }} />
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Đi muộn / Nửa ca</Text>
        </View>
      </View>
    </View>
  );
}

// ===================================================================================
// 2. BIỂU ĐỒ ĐỒNG HỒ TRÒN TIẾN ĐỘ (CIRCULAR PROGRESS GAUGE)
// ===================================================================================

export function CircularProgressGauge({
  percent,
  title,
  subtitle,
  size = 120,
  variant = 'brand',
}: {
  percent: number;
  title: string;
  subtitle: string;
  size?: number;
  variant?: 'brand' | 'success' | 'warning';
}) {
  const p = usePalette();
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  let strokeColor = p.brand;
  let lightBg = p.brandLight;
  if (variant === 'success') {
    strokeColor = p.emerald;
    lightBg = p.emeraldBg;
  } else if (variant === 'warning') {
    strokeColor = p.amber;
    lightBg = p.amberBg;
  }

  const borderWidth = Math.max(7, Math.round(size * 0.08));

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', marginVertical: 4 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth,
          borderColor: p.line,
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Active arc effect overlay */}
        <View
          style={{
            position: 'absolute',
            top: -borderWidth,
            left: -borderWidth,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
            borderColor: strokeColor,
            borderTopColor: strokeColor,
            borderRightColor: clamped > 25 ? strokeColor : 'transparent',
            borderBottomColor: clamped > 50 ? strokeColor : 'transparent',
            borderLeftColor: clamped > 75 ? strokeColor : 'transparent',
            transform: [{ rotateZ: '-45deg' }],
          }}
        />

        {/* Inner container */}
        <View
          style={{
            width: size - borderWidth * 2.8,
            height: size - borderWidth * 2.8,
            borderRadius: (size - borderWidth * 2.8) / 2,
            backgroundColor: lightBg,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
          }}
        >
          <Text
            style={{
              fontFamily: 'BeVietnamBold',
              fontSize: Math.max(16, Math.round(size * 0.18)),
              fontWeight: '700',
              color: strokeColor,
              lineHeight: Math.max(20, Math.round(size * 0.22)),
            }}
          >
            {clamped}%
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'BeVietnam',
              fontSize: Math.max(9, Math.round(size * 0.09)),
              color: p.muted,
              textAlign: 'center',
              marginTop: 1,
            }}
          >
            {title}
          </Text>
        </View>
      </View>

      <Text
        style={{
          fontFamily: 'BeVietnamBold',
          fontSize: 12,
          color: p.text,
          marginTop: 8,
          textAlign: 'center',
        }}
      >
        {subtitle}
      </Text>
    </View>
  );
}

// ===================================================================================
// 3. THANH ĐO PHÂN BỔ TRẠNG THÁI (STACKED BREAKDOWN METER)
// ===================================================================================

export interface MeterSegment {
  key: string;
  label: string;
  count: number;
  color: string;
  sublabel?: string;
}

export function StackedBreakdownMeter({
  segments,
  title,
  style,
}: {
  segments: MeterSegment[];
  title?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const total = segments.reduce((sum, s) => sum + s.count, 0);

  return (
    <View style={[{ gap: 10 }, style]}>
      {title && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label variant="subtitle">{title}</Label>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
            Tổng: {total}
          </Text>
        </View>
      )}

      {/* Multi-segment Bar */}
      <View
        style={{
          height: 14,
          flexDirection: 'row',
          borderRadius: 7,
          overflow: 'hidden',
          backgroundColor: p.surfaceHigh,
        }}
      >
        {total === 0 ? (
          <View style={{ flex: 1, backgroundColor: p.line }} />
        ) : (
          segments.map(seg => {
            const flexValue = Math.max(0.001, seg.count / total);
            return (
              <View
                key={seg.key}
                style={{
                  flex: flexValue,
                  backgroundColor: seg.color,
                }}
              />
            );
          })
        )}
      </View>

      {/* Segment Legend Grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
        {segments.map(seg => {
          const pct = total > 0 ? ((seg.count / total) * 100).toFixed(0) : '0';
          return (
            <View
              key={seg.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minWidth: '45%',
                flexGrow: 1,
              }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: seg.color,
                }}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.body }}>
                    {seg.label}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: p.text }}>
                    {seg.count} ({pct}%)
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ===================================================================================
// 4. BIỂU ĐỒ SO SÁNH QUỸ LƯƠNG & NHÂN SỰ THEO CHI NHÁNH / ĐƠN VỊ
// ===================================================================================

export function UnitPayrollComparisonChart({
  units,
  period,
}: {
  units: PayrollUnitItem[];
  period: string;
}) {
  const p = usePalette();
  const maxGross = Math.max(1, ...units.map(u => Number(u.total_gross) || 0));

  if (!units || units.length === 0) {
    return (
      <Card low style={{ alignItems: 'center', paddingVertical: 16 }}>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
          Chưa có số liệu quỹ lương chi nhánh kỳ {period}
        </Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {units.map((unit, idx) => {
        const gross = Number(unit.total_gross) || 0;
        const net = Number(unit.total_net) || 0;
        const widthPct = Math.max(6, Math.min(100, (gross / maxGross) * 100));

        return (
          <View key={unit.unit_name || idx} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Text style={{ fontSize: 13 }}>🏬</Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: 'BeVietnamBold',
                    fontSize: 12,
                    color: p.text,
                    flex: 1,
                  }}
                >
                  {unit.unit_name}
                </Text>
              </View>
              <Badge label={`${unit.employee_count} nhân sự`} size="sm" variant="neutral" />
            </View>

            {/* Horizontal Bar */}
            <View
              style={{
                height: 10,
                backgroundColor: p.surfaceLow,
                borderRadius: 5,
                overflow: 'hidden',
                marginVertical: 2,
              }}
            >
              <View
                style={{
                  width: `${widthPct}%`,
                  height: '100%',
                  backgroundColor: p.brand,
                  borderRadius: 5,
                }}
              />
            </View>

            {/* Numbers: Gross & Net */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
              <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                Gross: <Text style={{ fontFamily: 'BeVietnamBold', color: p.brandText }}>{formatVND(gross)}</Text>
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                Net: <Text style={{ fontFamily: 'BeVietnamBold', color: p.emeraldText }}>{formatVND(net)}</Text>
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
