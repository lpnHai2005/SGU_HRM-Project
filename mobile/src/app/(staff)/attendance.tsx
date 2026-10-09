import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { useSession } from '@/contexts/session';
import {
  Button,
  Card,
  Label,
  styles,
  usePalette,
  Badge,
  MetricBox,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { distanceMeters } from '@/services/geofence';
import { fastLocation } from '@/services/fast-location';
import { uploadAttendancePhoto } from '@/services/attendance-photo';
import { useAttendanceGps } from '@/hooks/use-attendance-gps';
import { AttendanceMap } from '@/components/attendance-map';
import { ensureLocationPermission } from '@/services/location-permission';
import {
  ApiError,
  displayTime,
  request,
  scheduleLabels,
  type Fence,
  vietnamPeriod,
  type Today,
} from '@/services/attendance';
import { statusLabels } from '@/services/staff';
import { assignedShift, storeLabel } from '@/services/presentation';
import { AttendanceAction } from '@/components/attendance-action';
import type { Schedule } from '@/services/staff';
import {
  savePending,
  loadPending,
  clearPending,
  type PendingAttendance as Pending,
} from '@/services/pending-attendance';

export default function AttendanceScreen() {
  const { token, ready, signOut } = useSession();
  const p = usePalette();
  const gpsPreview = useAttendanceGps();
  const [profile, setProfile] = useState<{
    employee_id?: number;
    full_name?: string;
    employee_code?: string;
    store_name?: string;
    department_name?: string;
    position_name?: string;
  } | null>(null);

  const [showGps, setShowGps] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const [today, setToday] = useState<Today | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [fence, setFence] = useState<Fence | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const [needsSettings, setNeedsSettings] = useState(false);
  const [position, setPosition] = useState<{ latitude: number; longitude: number }>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingReady, setPendingReady] = useState(false);
  const lock = useRef(false);
  const deadline = useRef(0);
  const selectedShift = assignedShift(today, schedules, new Date(clock).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }));

  const onError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'Không hoàn tất thao tác.');
    if (e instanceof ApiError && e.status === 401) void signOut();
  }, [signOut]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const [state, list, me] = await Promise.all([
        request<Today>('/attendances/today-status', token),
        request<Schedule[]>(`/mobile-attendance/my-schedules?period=${vietnamPeriod()}`, token),
        request<NonNullable<typeof profile>>('/auth/me', token),
      ]);
      setProfile(me);
      setToday(state);
      setSchedules(list);
      setFresh(true);

      const wait = state.can_check_out
        ? state.checkout_seconds_remaining || 0
        : state.cooldown_seconds_remaining;
      deadline.current = performance.now() + wait * 1000;
      setRemaining(wait);

      try {
        setFence(await request<Fence>('/mobile-attendance/geofence', token));
      } catch (e) {
        setFence(null);
        setError(e instanceof Error ? e.message : 'Không tải được vùng chấm công.');
      }
    } catch (e) {
      setFresh(false);
      setError(e instanceof Error ? e.message : 'Không tải được trạng thái.');
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally {
      setRefreshing(false);
    }
  }, [token, signOut]);

  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setToday(null);
        setProfile(null);

        setPosition(undefined);
        setShowGps(false);
        setPending(null);
        setFresh(false);
        setError('');
        setNotice('');
        return;
      }
      void refresh();
      const appState = AppState.addEventListener('change', state => {
        if (state === 'active' && !lock.current) void refresh();
      });
      const poll = setInterval(() => {
        if (AppState.currentState === 'active' && !lock.current) void refresh();
      }, 30000);
      const tick = setInterval(() => {
        setRemaining(Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000)));
        setClock(Date.now());
      }, 1000);
      return () => {
        appState.remove();
        clearInterval(poll);
        clearInterval(tick);
      };
    }, [token, refresh])
  );

  useEffect(() => {
    if (!profile?.employee_id) return;
    let active = true;
    const employee = profile.employee_id;
    loadPending(employee).then(async value => {
      if (!active) return;
      setPending(value);
      if (value && token) {
        try {
          const outcome = await request<{ state: string }>(`/mobile-attendance/requests/${value.body.request_id}`, token);
          if (outcome.state === 'SUCCESS') {
            await clearPending(employee);
            if (active) {
              setPending(null);
              setNotice('Đã khôi phục kết quả chấm công trước khi đóng app.');
            }
          }
        } catch (e) {
          if (active) onError(e);
        }
      }
      if (active) setPendingReady(true);
    }).catch(onError);
    return () => {
      active = false;
    };
  }, [profile?.employee_id, onError, token]);

  const discardPending = useCallback(async () => {
    if (profile?.employee_id) await clearPending(profile.employee_id);
    setPending(null);
  }, [profile]);

  const locate = useCallback(async () => {
    setStage('Đang kiểm tra vị trí GPS Showroom…');
    const permission = await ensureLocationPermission(Location);
    setNeedsSettings(!permission.granted && !permission.canAskAgain);
    if (!permission.granted) {
      throw new Error(permission.canAskAgain
        ? 'Cần quyền vị trí để chấm công. Vui lòng cho phép truy cập vị trí.'
        : 'Quyền vị trí đã bị chặn. Mở Cài đặt điện thoại để cho phép ứng dụng truy cập vị trí.');
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      throw new Error('GPS đang tắt. Vui lòng bật định vị trên thiết bị.');
    }
    const maxAccuracy = Math.min(25, fence?.radius_meters || 25);
    const gps = await fastLocation(
      async () => gpsPreview.current && Date.now() - gpsPreview.current.timestamp <= 1500
        ? gpsPreview.current : Location.getLastKnownPositionAsync({ maxAge: 1500, requiredAccuracy: maxAccuracy }),
      () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      value => !!fence && value.coords.accuracy !== null && value.coords.accuracy > 0
        && value.coords.accuracy <= maxAccuracy
        && distanceMeters(value.coords, fence) + value.coords.accuracy <= fence.radius_meters,
    );
    setPosition({ latitude: gps.coords.latitude, longitude: gps.coords.longitude });
    setGpsAccuracy(gps.coords.accuracy);
    return gps;
  }, [fence, gpsPreview]);

  async function relocate() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await locate();
    } catch (e) {
      onError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const handleSubmit = useCallback(async (checkOut: boolean, retry = false) => {
    if (lock.current || !token || !pendingReady || !profile?.employee_id) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let command = retry ? pending : null;
    try {
      if (command) {
        setStage('Đang tra cứu trạng thái yêu cầu trước…');
        const outcome = await request<{ state: string; result?: { message?: string } }>(
          `/mobile-attendance/requests/${command.body.request_id}`,
          token
        );
        if (outcome.state === 'SUCCESS') {
          await discardPending();

          setNotice(outcome.result?.message || 'Yêu cầu trước đã được máy chủ ghi nhận thành công.');
          await refresh(); router.replace('/(staff)');
          return;
        }
        if (outcome.state !== 'NOT_FOUND' || Date.now() - command.createdAt > 120000) {
          await discardPending();

          throw new Error('Yêu cầu cũ chưa thành công hoặc thời hạn đã hết. Vui lòng chụp ảnh và thử lại.');
        }
      }
      if (!command) {
        if (!selectedShift) throw new Error('Chưa có ca được phân công hôm nay. Liên hệ cửa hàng trưởng.');
        setStage('Đang kiểm tra kết nối máy chủ…');
        await request('/auth/me', token, undefined, undefined, 5000);
        let gps = await locate();
        let { latitude, longitude, accuracy } = gps.coords;
        if (!fence) throw new Error('Chưa tải được vùng chấm công cửa hàng.');
        if (!accuracy || accuracy > Math.min(100, fence.radius_meters) || distanceMeters(gps.coords, fence) > fence.radius_meters) {
          setShowGps(true);
          throw new Error('Vị trí GPS ngoài phạm vi cửa hàng. Xem bản đồ để đối chiếu vị trí.');
        }
        setShowGps(false);
        setStage('Vị trí hợp lệ. Chụp ảnh xác nhận…');
        if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Cần quyền camera để chụp ảnh xác nhận.');
        const shot = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: .6, allowsEditing: false, mediaTypes: ['images'] });
        if (shot.canceled) return;
        const capturedPhoto = shot.assets[0];
        gps = await locate();
        ({ latitude, longitude, accuracy } = gps.coords);
        if (!accuracy || accuracy > Math.min(100, fence.radius_meters) || distanceMeters(gps.coords, fence) > fence.radius_meters) {
          setShowGps(true); throw new Error('Vị trí đã thay đổi hoặc GPS chưa đủ chính xác. Chưa gửi ảnh và chấm công.');
        }
        setStage('Đang chuẩn hóa và tải ảnh minh chứng…');
        const upload = await uploadAttendancePhoto(capturedPhoto, token);
        command = {
          createdAt: Date.now(),
          path: `/mobile-attendance/${checkOut ? 'check-out' : 'check-in'}`,
          body: {
            request_id: Crypto.randomUUID(),
            photo_token: upload.photo_token,
            latitude,
            longitude,
            accuracy_meters: accuracy,
            captured_at: new Date(gps.timestamp).toISOString(),
            shift_id: selectedShift!.shift_id,
          },
        };
        await savePending(profile.employee_id, command);
        setPending(command);
      }
      setStage('Đang gửi giao dịch xác thực chấm công…');
      const result = await request<{ message: string; schedule_status?: string }>(
        command.path,
        token,
        command.body
      );
      await discardPending();

      setNotice(`${result.message}${result.schedule_status ? ` • ${scheduleLabels[result.schedule_status] || result.schedule_status}` : ''}`);
      await refresh(); router.replace('/(staff)');
    } catch (e) {
      setNotice('');
      onError(e);
      if (e instanceof ApiError && e.status < 500 && ![401, 403, 404].includes(e.status)) {
        await discardPending();
        if (e.status === 422 && /GPS|vị trí/i.test(e.message)) setShowGps(true);
        if (e.status === 429) deadline.current = performance.now() + e.retryAfter * 1000;
      }
      await refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [token, pendingReady, profile, pending, selectedShift, fence, discardPending, locate, onError, refresh]);

  const distance = fence && position ? distanceMeters(position, fence) : null;
  const elapsed = today?.can_check_out && today.check_in_time ? Math.max(0, (clock - Date.parse(today.check_in_time)) / 3600000) : 0;
  const actionDisabled = busy || !pendingReady || !fresh || !fence || remaining > 0 || (!selectedShift || (!today?.can_check_out && !today?.can_check_in));
  if (!ready) return <ActivityIndicator style={{ margin: 40 }} />;
  if (!token) return <Redirect href="/login" />;
  return <>
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setError(''); void refresh(); }} />}>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
        <Badge label={today?.can_check_out ? 'ĐANG LÀM VIỆC' : 'CHẤM CÔNG HÔM NAY'} variant="brand" />
        <Label variant="display" style={{ fontSize: 36, lineHeight: 46, fontVariant: ['tabular-nums'] }}>{new Date(clock).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</Label>
        <Label muted>{new Date(clock).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</Label>
      </View>
      <LoadingBar active={busy || refreshing} label={busy ? stage : 'Đang đồng bộ chấm công…'} />
      {!!error && <Card style={{ backgroundColor: p.dangerBg }}><Label style={{ color: p.dangerText }}>{error}</Label><Button title="Thử tải lại" secondary disabled={busy} onPress={() => { setError(''); void refresh(); }} /></Card>}
      {needsSettings && <Button title="Mở Cài đặt cấp quyền vị trí" secondary onPress={() => void Linking.openSettings().catch(onError)} />}
      {!!notice && <Card><Label style={{ color: p.emeraldText }}>{notice}</Label></Card>}
      <Card><View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Label variant="subtitle">{profile?.full_name || 'Nhân viên'}</Label><Badge label={profile?.employee_code || 'TECHZONE'} /></View><Label muted>{storeLabel(profile?.store_name)}</Label>
        {!!selectedShift?.store_name && selectedShift.store_name !== profile?.store_name && <Label muted>{today?.can_check_out ? 'Cửa hàng của lượt đang mở' : 'Cửa hàng trong lịch phân ca'}: {storeLabel(selectedShift.store_name)}</Label>}
        <Label variant="bold">{selectedShift?.shift_name || 'Chưa được phân ca hôm nay'}</Label>
        {selectedShift?.start_time && selectedShift.end_time && <Label muted>{selectedShift.start_time.slice(0,5)} – {selectedShift.end_time.slice(0,5)}</Label>}
        <View style={styles.row}><MetricBox label="Giờ vào" value={displayTime(today?.check_in_time || null)} /><MetricBox label="Giờ ra" value={displayTime(today?.check_out_time || null)} /></View>
        {today?.can_check_out && <Label muted>Đã làm {elapsed.toFixed(2)} giờ · Giờ công cuối cùng do máy chủ tính</Label>}
      </Card>
      {!selectedShift && <Label muted>Chưa có ca được phân công hôm nay. Vui lòng liên hệ cửa hàng trưởng.</Label>}
      {pending ? <Card><Label style={{ color: p.amberText }}>Đang chờ xác định kết quả lần trước.</Label><Button title="Kiểm tra / thử lại yêu cầu" disabled={busy} onPress={() => void handleSubmit(false, true)} /></Card> : <AttendanceAction checkOut={!!today?.can_check_out} disabled={actionDisabled} onPress={() => void handleSubmit(!!today?.can_check_out)} />}
      {remaining > 0 && <Label muted>Vui lòng chờ {remaining} giây để chấm công tiếp.</Label>}
      <Label variant="caption" muted>GPS được chuẩn bị khi mở màn hình này nếu đã cấp quyền; tự dừng khi rời màn hình hoặc chuyển app sang nền.</Label>
      {today?.check_in_time && <Card><Label variant="subtitle">Kết quả lượt hiện tại</Label><Badge label={statusLabels[today.status] || today.status} variant="info" /><Label muted>{scheduleLabels[today.schedule_status] || 'Chưa đối chiếu'}</Label><Label>Muộn {today.late_minutes || 0} phút · Sớm {today.early_minutes || 0} phút</Label><Label>Giờ công {Number(today.actual_work_hours || 0).toFixed(2)} · OT {today.overtime_hours || 0} giờ</Label><Button title="Xem nhật ký chấm công" secondary onPress={() => router.push('/(staff)/activity')} /></Card>}
    </ScrollView>
    <Modal visible={showGps && !!fence && !!position} animationType="slide" onRequestClose={() => setShowGps(false)}><ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={[styles.content, { paddingTop: 56 }]}>
      <Badge label="KIỂM TRA VỊ TRÍ" variant="danger" /><Label variant="title">{distance !== null && fence && distance > fence.radius_meters ? 'GPS của bạn đang ngoài vùng cho phép' : 'Kiểm tra độ chính xác GPS'}</Label>
      <Label muted>Đến đúng cửa hàng được phân công và lấy lại vị trí.</Label>
      <Card>{fence && <AttendanceMap fence={fence} position={position} />}<Label variant="subtitle">{storeLabel(fence?.store_name)}</Label><Label muted>{fence?.store_address || 'Địa chỉ chưa cập nhật'}</Label><View style={styles.row}><MetricBox label="Khoảng cách" value={`${distance?.toFixed(0) ?? '—'} m`} variant="danger" /><MetricBox label="Bán kính" value={`${fence?.radius_meters ?? '—'} m`} /></View><Label muted>GPS của bạn: {position?.latitude.toFixed(6)}, {position?.longitude.toFixed(6)}</Label><Label muted>Độ chính xác: ±{gpsAccuracy?.toFixed(0) ?? '—'} m</Label></Card>
      <LoadingBar active={busy} label="Đang lấy lại vị trí…" />{!!error && <Label style={{ color: p.dangerText }}>{error}</Label>}<Button title="Lấy lại vị trí" disabled={busy} onPress={() => void relocate()} /><Button title="Quay lại chấm công" secondary disabled={busy} onPress={() => setShowGps(false)} />
    </ScrollView></Modal>
  </>;
}
