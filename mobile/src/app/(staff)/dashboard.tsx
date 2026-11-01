import { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Pressable,
  RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppIcon, AppText as Text } from '@/components/app-icon';
import {
  Card,
  Label,
  Badge,
  Button,
  MetricBox,
  ProgressBar,
  styles,
  usePalette,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useSession } from '@/contexts/session';
import { useResource } from '@/hooks/use-resource';
import { type Profile } from '@/services/staff';
import { storeLabel } from '@/services/presentation';
import { vietnamPeriod } from '@/services/attendance';
import {
  fetchEmployeeSummary,
  fetchEmployeeHistory,
  fetchDashboardStats,
  fetchDashboardKpis,
  fetchLeaveSummaryStats,
  fetchPayrollFundSummary,
  formatVND,
  generatePeriodOptions,
  type EmployeeSummaryData,
  type AttendanceHistoryRecord,
  type ManagerDashboardStats,
  type ManagerDashboardKpis,
  type LeaveSummaryStats,
  type PayrollFundResponse,
} from '@/services/dashboard';
import {
  DailyHoursBarChart,
  CircularProgressGauge,
  StackedBreakdownMeter,
  UnitPayrollComparisonChart,
} from '@/components/dashboard-charts';

export default function DashboardScreen() {
  const p = usePalette();
  const { token } = useSession();
  const profile = useResource<Profile>('/auth/me', 30000);

  const [period, setPeriod] = useState<string>(vietnamPeriod);
  const periodOptions = useMemo(() => generatePeriodOptions(8), []);

  // Role determination
  const userRoles = useMemo(() => profile.data?.roles || [], [profile.data]);
  const isStoreManager = userRoles.includes('STORE_MANAGER');
  const isHrManager = userRoles.includes('HR_MANAGER');
  const isAdmin = userRoles.includes('ADMIN');
  const isManager = isStoreManager || isHrManager || isAdmin;

  // View mode switcher for managers: 'manager' vs 'personal'
  const [viewMode, setViewMode] = useState<'manager' | 'personal'>('manager');

  // Employee data state
  const [employeeSummary, setEmployeeSummary] = useState<EmployeeSummaryData | null>(null);
  const [employeeHistory, setEmployeeHistory] = useState<AttendanceHistoryRecord[]>([]);

  // Manager data state
  const [managerStats, setManagerStats] = useState<ManagerDashboardKpis | null>(null);
  const [financeStats, setFinanceStats] = useState<ManagerDashboardStats | null>(null);
  const [financeError, setFinanceError] = useState('');
  const [leaveStats, setLeaveStats] = useState<LeaveSummaryStats | null>(null);
  const [payrollFund, setPayrollFund] = useState<PayrollFundResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Main data loader
  const loadData = useCallback(async () => {
    if (!token || !profile.data) return;
    setLoading(true);
    setError('');

    try {
      const loads: { name: string; task: Promise<unknown> }[] = [];
      if (!isManager || viewMode === 'personal') {
        loads.push(
          { name: 'Bảng công cá nhân', task: fetchEmployeeSummary(period, token).then(setEmployeeSummary).catch(error => { setEmployeeSummary(null); throw error; }) },
          { name: 'Lịch sử chấm công', task: fetchEmployeeHistory(period, token).then(setEmployeeHistory).catch(error => { setEmployeeHistory([]); throw error; }) }
        );
      }
      if (isManager && viewMode === 'manager') {
        loads.push(
          { name: 'Bốn chỉ số Dashboard', task: fetchDashboardKpis(token).then(setManagerStats).catch(error => { setManagerStats(null); throw error; }) },
          { name: 'Thống kê đơn từ', task: fetchLeaveSummaryStats(token).then(setLeaveStats).catch(error => { setLeaveStats(null); throw error; }) }
        );
        loads.push({ name: 'Quỹ lương & doanh số', task: fetchDashboardStats(period, token)
          .then(data => { setFinanceStats(data); setFinanceError(''); })
          .catch(cause => {
            setFinanceStats(null);
            setFinanceError(cause instanceof Error ? cause.message : 'Không tải được quỹ lương và doanh số.');
          }) });
        if (isAdmin || isHrManager) {
          loads.push({ name: 'Quỹ lương', task: fetchPayrollFundSummary(period, token).then(setPayrollFund).catch(error => { setPayrollFund(null); throw error; }) });
        }
      }

      const results = await Promise.allSettled(loads.map(load => load.task));
      const failures = results.flatMap((result, index) => result.status === 'rejected'
        ? [`${loads[index].name}: ${result.reason instanceof Error ? result.reason.message : 'Không tải được dữ liệu.'}`]
        : []);
      if (failures.length) setError(failures.join('\n'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được số liệu báo cáo.');
    } finally {
      setLoading(false);
    }
  }, [token, profile.data, period, isManager, isAdmin, isHrManager, viewMode]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  // Computed employee metrics
  const standardDays = employeeSummary?.working_days?.standard_days || 26;
  const actualDays = employeeSummary?.working_days?.actual_days || 0;
  const totalHours = employeeSummary?.working_days?.total_hours || 0;
  const ratePercent = Math.min(100, Math.round((actualDays / standardDays) * 100));
  const lateCount = employeeSummary?.late_arrivals?.count || 0;
  const lateMinutes = employeeSummary?.late_arrivals?.minutes || 0;
  const earlyCount = employeeSummary?.early_departures?.count || 0;
  const earlyMinutes = employeeSummary?.early_departures?.minutes || 0;
  const usedLeave = employeeSummary?.leave_quota?.used_leave || 0;
  const remainingLeave = employeeSummary?.leave_quota?.remaining_leave || 0;
  const annualLeave = employeeSummary?.leave_quota?.annual_leave || 12;
  const otHours = employeeSummary?.overtime?.hours || 0;
  const otShifts = employeeSummary?.overtime?.shifts_count || 0;

  // Computed manager metrics
  const activeEmp = managerStats?.active_employees || 0;
  const checkedIn = managerStats?.attendance_today?.checked_in || 0;
  const lateToday = managerStats?.attendance_today?.late || 0;
  const attendanceRate = activeEmp > 0 ? Math.round((checkedIn / activeEmp) * 100) : 0;
  const pendingLeaves = managerStats?.pending_leaves ?? (isStoreManager
    ? leaveStats?.pending_store_approval
    : leaveStats ? leaveStats.pending_store_approval + leaveStats.pending_hr_approval : undefined) ?? 0;

  const storeDisplay = storeLabel(profile.data?.store_name);

  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: 40 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} />}
    >
      {/* View switch (managers) */}
      {isManager && (
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 6, backgroundColor: p.surfaceLow }}>
          {([['manager', isStoreManager ? 'Chi nhánh' : 'Toàn chuỗi'], ['personal', 'Cá nhân']] as const).map(([key, label]) => {
            const active = viewMode === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setViewMode(key)}
                style={{ flex: 1, height: 34, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? p.line : 'transparent', backgroundColor: active ? p.card : 'transparent' }}
              >
                <Text style={{ fontFamily: active ? 'BeVietnamBold' : 'BeVietnam', fontSize: 13, color: active ? p.text : p.muted }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Period chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {periodOptions.map(opt => {
          const active = opt.value === period;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Chọn ${opt.label}`}
              onPress={() => setPeriod(opt.value)}
              style={{ height: 32, paddingHorizontal: 12, borderRadius: 6, justifyContent: 'center', backgroundColor: active ? p.brand : p.card, borderWidth: 1, borderColor: active ? p.brand : p.line }}
            >
              <Text style={{ fontFamily: active ? 'BeVietnamBold' : 'BeVietnam', fontSize: 12, color: active ? p.onBrand : p.text }}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <LoadingBar active={loading} label="Đang đối soát số liệu báo cáo từ máy chủ…" />

      {!!(error || profile.error) && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>{error || profile.error}</Text>
          <Button title="Tải lại số liệu" secondary onPress={() => { profile.reload(); void loadData(); }} />
        </Card>
      )}

      {/* ========================================================================= */}
      {/* CASE 1: MANAGER DASHBOARD (HR, ADMIN, STORE MANAGER)                     */}
      {/* ========================================================================= */}
      {isManager && viewMode === 'manager' && (
        <>
          {/* Scope line */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 15, color: p.text }}>
                {isStoreManager ? storeDisplay : 'Toàn chuỗi TechZone'}
              </Text>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, marginTop: 2 }}>
                Hôm nay có mặt <Text style={{ fontFamily: 'MonoBold', fontSize: 12, color: p.text }}>{checkedIn}/{activeEmp}</Text> · {attendanceRate}%
              </Text>
            </View>
            <Badge label="Trực tiếp" variant="success" pulse size="sm" />
          </View>

          {/* Action needed */}
          {pendingLeaves > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(staff)/requests')}
              style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 8, backgroundColor: p.amberBg, borderWidth: 1, borderColor: p.amberBg }}
            >
              <AppIcon name="alert-circle-outline" size={18} color={p.amberText} />
              <Text style={{ flex: 1, fontFamily: 'BeVietnam', fontSize: 13, lineHeight: 20, color: p.text }}>
                Có <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>{pendingLeaves} đơn nghỉ phép</Text> đang chờ {isStoreManager ? 'cửa hàng trưởng duyệt' : 'HR xử lý'}.{' '}
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.amberText }}>Duyệt ngay →</Text>
              </Text>
            </Pressable>
          )}

          {/* Core 4 Executive KPI Cards */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricBox
              label="Tổng nhân sự"
              onPress={() => router.push('/(staff)/activity?kind=all')}
              value={managerStats ? activeEmp : '—'}
              subtext="Đang hoạt động"
              icon="people-outline"
              variant="brand"
            />
            <MetricBox
              label="Đang làm hôm nay"
              onPress={() => router.push('/(staff)/activity?kind=working')}
              value={managerStats?.attendance_today?.working ?? '—'}
              subtext={`Tỷ lệ ${attendanceRate}%`}
              icon="radio-button-on"
              variant={attendanceRate >= 80 ? 'success' : 'warning'}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricBox
              label="Đi muộn hôm nay"
              onPress={() => router.push('/(staff)/activity?kind=late')}
              value={managerStats ? `${lateToday} người` : '—'}
              subtext="Ghi nhận trong ngày"
              icon="time-outline"
              variant={lateToday > 0 ? 'warning' : 'neutral'}
            />
            <MetricBox
              label="Đơn chờ duyệt"
              onPress={() => router.push('/(staff)/requests')}
              value={managerStats || leaveStats ? `${pendingLeaves} đơn` : '—'}
              subtext="Cần xem xét"
              icon="document-text-outline"
              variant={pendingLeaves > 0 ? 'warning' : 'neutral'}
            />
          </View>

          {/* Today's Workforce Status Visual Meter */}
          <Card style={{ gap: 12 }}>
            <Label variant="subtitle">Tỷ lệ hiện diện hôm nay</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <CircularProgressGauge
                percent={attendanceRate}
                title="Có mặt"
                subtitle={`${checkedIn}/${activeEmp} nhân sự`}
                size={110}
                variant={attendanceRate >= 80 ? 'success' : 'warning'}
              />
              <View style={{ flex: 1, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Đang làm việc:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.emeraldText }}>
                    {managerStats?.attendance_today?.working ?? '—'} nhân sự
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Nghỉ phép hôm nay:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.brandText }}>
                    {leaveStats?.on_leave_today || 0} nhân sự
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Chưa vào ca / vắng:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.text }}>
                    {Math.max(0, activeEmp - checkedIn - (leaveStats?.on_leave_today || 0))} nhân sự
                  </Text>
                </View>
              </View>
            </View>
          </Card>

          {/* Payroll Fund & Revenue Cards (For HR/Admin or Store Mgr) */}
          {financeStats ? (
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Label variant="subtitle" numberOfLines={1}>Quỹ lương & Doanh số</Label>
                  <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                    Kỳ thống kê: {period}
                  </Text>
                </View>
                <Badge label="Toàn chuỗi" size="sm" variant="neutral" />
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <MetricBox
                  label="Quỹ lương Net"
                  value={formatVND(financeStats.monthly_net_payroll_fund)}
                  subtext="Thực chi nhân viên"
                  icon="wallet-outline"
                  variant="brand"
                />
                <MetricBox
                  label="Quỹ Gross dự tính"
                  value={formatVND(financeStats.monthly_gross_payroll_fund)}
                  subtext="Trước khấu trừ"
                  icon="bar-chart-outline"
                  variant="neutral"
                />
              </View>

              {financeStats.total_retail_revenue > 0 && (
                <View
                  style={{
                    backgroundColor: p.surfaceLow,
                    borderRadius: 8,
                    padding: 12,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: p.line,
                    gap: 8,
                  }}
                >
                  <View style={{ gap: 2, flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                      Tổng doanh số bán lẻ trong kỳ:
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 16, color: p.emeraldText }}>
                      {formatVND(financeStats.total_retail_revenue)}
                    </Text>
                  </View>
                  <AppIcon name="analytics-outline" style={{ fontSize: 24 }} />
                </View>
              )}
            </Card>
          ) : !!financeError && (
            <Card low><Text style={{ color: p.muted, fontFamily: 'BeVietnam', fontSize: 12 }}>
              Quỹ lương & doanh số chưa tải được: {financeError}
            </Text></Card>
          )}

          {/* Unit Comparison Chart (For Admin / HR Manager) */}
          {(isAdmin || isHrManager) && payrollFund && payrollFund.by_unit && payrollFund.by_unit.length > 0 && (
            <Card style={{ gap: 14 }}>
              <View style={{ gap: 2 }}>
                <Label variant="subtitle" numberOfLines={1}>Phân bổ chi phí theo chi nhánh</Label>
                <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                  So sánh quy mô nhân sự & quỹ lương giữa các điểm bán
                </Text>
              </View>
              <UnitPayrollComparisonChart units={payrollFund.by_unit} period={period} />
            </Card>
          )}

          {/* Leave Status Meter */}
          {leaveStats && (
            <Card style={{ gap: 12 }}>
              <StackedBreakdownMeter
                title="Cơ cấu xử lý đơn từ & nghỉ phép"
                segments={[
                  {
                    key: 'approved',
                    label: 'Đã duyệt',
                    count: leaveStats.approved,
                    color: p.emerald,
                  },
                  {
                    key: 'pending_store',
                    label: 'Chờ duyệt CH',
                    count: leaveStats.pending_store_approval,
                    color: p.amber,
                  },
                  {
                    key: 'pending_hr',
                    label: 'Chờ duyệt HR',
                    count: leaveStats.pending_hr_approval,
                    color: p.brand,
                  },
                  {
                    key: 'rejected',
                    label: 'Từ chối',
                    count: leaveStats.rejected,
                    color: p.danger,
                  },
                ]}
              />
            </Card>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* CASE 2: EMPLOYEE DASHBOARD (REGULAR EMPLOYEE & PERSONAL VIEW)             */}
      {/* ========================================================================= */}
      {(!isManager || viewMode === 'personal') && (
        <>
          {/* 4 Main Core Metrics (As Requested by User) */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* 1. Tổng ngày công */}
            <Card style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Tổng ngày công</Text>
                <AppIcon name="briefcase-outline" style={{ fontSize: 16 }} />
              </View>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 19, color: p.brandText, fontWeight: '700' }}>
                {actualDays} / {standardDays}
              </Text>
              <View style={{ gap: 3 }}>
                <ProgressBar progress={ratePercent} color={p.brand} />
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                  Đạt {ratePercent}% công chuẩn
                </Text>
              </View>
            </Card>

            {/* 2. Tổng giờ làm */}
            <MetricBox
              label="Tổng giờ làm"
              value={`${totalHours}h`}
              subtext={`TB ${(actualDays > 0 ? totalHours / actualDays : 0).toFixed(1)}h / ngày công`}
              icon="time-outline"
              variant="brand"
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* 3. Đi muộn */}
            <MetricBox
              label="Đi muộn"
              value={`${lateCount} lần`}
              subtext={lateCount > 0 ? `Tổng ${lateMinutes} phút` : 'Đúng giờ 100%'}
              icon="warning-outline"
              variant={lateCount > 0 ? 'warning' : 'neutral'}
            />

            {/* 4. Ngày đã nghỉ phép */}
            <MetricBox
              label="Nghỉ phép"
              value={`${usedLeave} ngày`}
              subtext={`Còn ${remainingLeave}/${annualLeave} ngày phép`}
              icon="sunny-outline"
              variant="success"
            />
          </View>

          {/* Secondary Stats */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MetricBox
              label="Giờ ngoài ca ghi nhận"
              value={`+${otHours}h`}
              subtext={`${otShifts} phiên có giờ ngoài ca`}
              icon="flash-outline"
              variant="brand"
            />
            <MetricBox
              label="Về sớm quy chuẩn"
              value={`${earlyCount} lần`}
              subtext={`Tổng ${earlyMinutes} phút`}
              icon="log-out-outline"
              variant={earlyCount > 0 ? 'warning' : 'neutral'}
            />
          </View>

          {/* Chart 1: Daily Work Hours Bar Chart */}
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Label variant="subtitle">Biểu đồ giờ làm theo ngày</Label>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                  Chi tiết thời gian các ca làm việc trong kỳ {period}
                </Text>
              </View>
              <Badge label={`${employeeHistory.length} ca`} size="sm" variant="brand" />
            </View>
            <DailyHoursBarChart records={employeeHistory} period={period} />
          </Card>

          {/* Chart 2: Circular Progress Gauge & Breakdown */}
          <Card style={{ gap: 14 }}>
            <Label variant="subtitle">Cơ cấu chuyên cần & Tỷ lệ công tháng</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <CircularProgressGauge
                percent={ratePercent}
                title="Đạt chuẩn"
                subtitle={`${actualDays}/${standardDays} ngày công`}
                size={110}
                variant={ratePercent >= 80 ? 'success' : 'brand'}
              />
              <View style={{ flex: 1, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Đúng giờ:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.emeraldText }}>
                    {Math.max(0, actualDays - lateCount)} ca
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Đi muộn:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.amberText }}>
                    {lateCount} ca
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Nghỉ phép đã duyệt:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.brandText }}>
                    {usedLeave} ngày
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>Quỹ phép khả dụng:</Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.text }}>
                    {remainingLeave} ngày
                  </Text>
                </View>
              </View>
            </View>
          </Card>

          {/* Audit & Regulations Summary */}
          <Card low style={{ gap: 8 }}>
            <Label variant="caption">Quy chuẩn tính công & đối soát</Label>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted, lineHeight: 17 }}>
              • Định mức công chuẩn hàng tháng: 26 công (~208 giờ).
            </Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted, lineHeight: 17 }}>
              • Đi muộn: Ghi nhận khi check-in sau mốc bắt đầu ca quá 15 phút.
            </Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted, lineHeight: 17 }}>
              • Giờ ngoài ca được ghi nhận từ check-in/check-out và bản chụp ca. Đây chưa phải OT được HR duyệt và không tự được tính lương.
            </Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}
