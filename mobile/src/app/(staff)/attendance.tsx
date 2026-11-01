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
  clockTime,
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
  const outside = distance !== null && !!fence && distance > fence.radius_meters;
  const working = !!today?.can_check_out;
  return <>
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setError(''); void refresh(); }} />}>
      <LoadingBar active={busy || refreshing} label={busy ? stage : 'Đang đồng bộ chấm công…'} />
      {!!error && <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}><Label style={{ color: p.dangerText }}>{error}</Label><Button title="Thử tải lại" secondary disabled={busy} onPress={() => { setError(''); void refresh(); }} /></Card>}
      {needsSettings && <Button title="Mở Cài đặt cấp quyền vị trí" secondary onPress={() => void Linking.openSettings().catch(onError)} />}

      {/* Shift */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Label variant="bold" style={{ fontSize: 15 }}>
            {selectedShift?.shift_name || 'Chưa được phân ca hôm nay'}
            {!!(selectedShift?.start_time && selectedShift.end_time) && <Label style={{ fontFamily: 'Mono', fontSize: 14 }}>{'  '}{selectedShift.start_time.slice(0, 5)} – {selectedShift.end_time.slice(0, 5)}</Label>}
          </Label>
          <Label muted variant="caption">{storeLabel(selectedShift?.store_name || profile?.store_name)}{fence?.store_address ? ` · ${fence.store_address}` : ''}</Label>
        </View>
        {working ? <Badge label="Đã vào ca" variant="success" pulse size="sm" /> : today?.check_out_time ? <Badge label="Đã kết thúc" size="sm" /> : <Badge label="Chưa vào ca" size="sm" />}
      </Card>

      {/* Location */}
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        {fence && position ? <AttendanceMap fence={fence} position={position} /> : (
          <View style={{ height: 150, backgroundColor: p.surfaceLow, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.emerald, backgroundColor: p.emeraldBg, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: p.text, borderWidth: 2, borderColor: p.card }} />
            </View>
            <Label muted variant="caption">{fence ? `Vùng chấm công · ${storeLabel(fence.store_name)}` : 'Chưa tải được vùng chấm công cửa hàng.'}</Label>
          </View>
        )}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: p.line }}>
          <Stat label="Khoảng cách" value={distance !== null ? `${distance.toFixed(0)}m` : '—'} color={outside ? p.dangerText : undefined} />
          <Stat label="Bán kính" value={fence ? `${fence.radius_meters}m` : '—'} divider />
          <Stat label="Độ chính xác" value={gpsAccuracy !== null ? `±${gpsAccuracy.toFixed(0)}m` : '—'} divider />
        </View>
      </Card>

      {!!notice && <Callout tone={outside ? 'danger' : 'success'} text={notice} />}
      {!notice && distance !== null && <Callout tone={outside ? 'danger' : 'success'} text={outside ? 'Vị trí GPS ngoài phạm vi cửa hàng. Đến đúng cửa hàng được phân công và lấy lại vị trí.' : 'Vị trí hợp lệ. Bạn đang trong phạm vi cửa hàng được phân công.'} />}
      {!selectedShift && <Callout tone="neutral" text="Chưa có ca được phân công hôm nay. Vui lòng liên hệ cửa hàng trưởng." />}

      {/* Actions */}
      <View style={{ gap: 8 }}>
        {pending
          ? <Card style={{ backgroundColor: p.amberBg, borderColor: p.amber }}><Label style={{ color: p.amberText }}>Đang chờ xác định kết quả lần trước.</Label><Button title="Kiểm tra / thử lại yêu cầu" disabled={busy} onPress={() => void handleSubmit(false, true)} /></Card>
          : <AttendanceAction checkOut={working} disabled={actionDisabled} onPress={() => void handleSubmit(working)} />}
        {!!fence && <Button title="Lấy lại vị trí" icon="refresh-outline" secondary disabled={busy} onPress={() => void relocate()} />}
      </View>
      {remaining > 0 && <Label muted variant="caption">Vui lòng chờ <Label style={{ fontFamily: 'Mono', fontSize: 12 }}>{remaining}</Label> giây để chấm công tiếp.</Label>}

      {/* Current result */}
      <Card style={{ gap: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Label style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>Kết quả lượt hiện tại</Label>
          <Label style={{ fontFamily: 'Mono', fontSize: 12, color: p.muted }}>{new Date(clock).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</Label>
        </View>
        <Line label="Giờ vào" value={today?.check_in_time ? `${clockTime(today.check_in_time)} · ${statusLabels[today.status] || today.status}` : 'Chưa ghi nhận'} mono={!!today?.check_in_time} />
        <Line label="Giờ ra" value={today?.check_out_time ? clockTime(today.check_out_time) : 'Chưa ghi nhận'} mono={!!today?.check_out_time} />
        {working && <Line label="Đã làm" value={`${elapsed.toFixed(2)}h`} mono />}
        {!!today?.check_in_time && <Line label="Muộn / Sớm" value={`${today.late_minutes || 0}′ / ${today.early_minutes || 0}′`} mono />}
        {!!today?.check_in_time && <Line label="Đối chiếu lịch" value={scheduleLabels[today.schedule_status] || 'Chưa đối chiếu'} last />}
        {!today?.check_in_time && <Line label="Trạng thái" value="Chưa chấm công" last />}
        <Button title="Xem nhật ký chấm công →" variant="secondary" style={{ marginTop: 12 }} onPress={() => router.push('/(staff)/activity')} />
      </Card>
      <Label variant="caption" muted>GPS được chuẩn bị khi mở màn hình này nếu đã cấp quyền; tự dừng khi rời màn hình hoặc chuyển app sang nền.</Label>
    </ScrollView>

    {/* GPS check sheet (shown when the server rejects the location) */}
    <Modal visible={showGps && !!fence && !!position} animationType="slide" onRequestClose={() => setShowGps(false)}><ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={[styles.content, { paddingTop: 56 }]}>
      <Badge label="Kiểm tra vị trí" variant="danger" /><Label variant="title">{outside ? 'GPS của bạn đang ngoài vùng cho phép' : 'Kiểm tra độ chính xác GPS'}</Label>
      <Label muted>Đến đúng cửa hàng được phân công và lấy lại vị trí.</Label>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        {fence && <AttendanceMap fence={fence} position={position} />}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: p.line }}>
          <Stat label="Khoảng cách" value={distance !== null ? `${distance.toFixed(0)}m` : '—'} color={outside ? p.dangerText : undefined} />
          <Stat label="Bán kính" value={fence ? `${fence.radius_meters}m` : '—'} divider />
          <Stat label="Độ chính xác" value={gpsAccuracy !== null ? `±${gpsAccuracy.toFixed(0)}m` : '—'} divider />
        </View>
        <View style={{ padding: 14, gap: 2 }}>
          <Label variant="bold">{storeLabel(fence?.store_name)}</Label>
          <Label muted variant="caption">{fence?.store_address || 'Địa chỉ chưa cập nhật'}</Label>
          <Label muted variant="caption">GPS của bạn: <Label style={{ fontFamily: 'Mono', fontSize: 12, color: p.muted }}>{position?.latitude.toFixed(6)}, {position?.longitude.toFixed(6)}</Label></Label>
        </View>
      </Card>
      <LoadingBar active={busy} label="Đang lấy lại vị trí…" />{!!error && <Callout tone="danger" text={error} />}
      <Button title="Lấy lại vị trí" disabled={busy} onPress={() => void relocate()} /><Button title="Quay lại chấm công" secondary disabled={busy} onPress={() => setShowGps(false)} />
    </ScrollView></Modal>
  </>;

  function Stat({ label, value, color, divider }: { label: string; value: string; color?: string; divider?: boolean }) {
    return <View style={{ flex: 1, padding: 12, borderLeftWidth: divider ? 1 : 0, borderLeftColor: p.line }}>
      <Label muted variant="caption">{label}</Label>
      <Label style={{ fontFamily: 'MonoBold', fontSize: 16, marginTop: 2, color: color || p.text }}>{value}</Label>
    </View>;
  }
  function Line({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
    return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: p.line }}>
      <Label muted style={{ fontSize: 13 }}>{label}</Label>
      <Label style={{ fontSize: 13, fontFamily: mono ? 'MonoBold' : 'BeVietnamBold', flexShrink: 1, textAlign: 'right' }}>{value}</Label>
    </View>;
  }
  function Callout({ tone, text }: { tone: 'success' | 'danger' | 'neutral'; text: string }) {
    const bg = tone === 'success' ? p.emeraldBg : tone === 'danger' ? p.dangerBg : p.surfaceLow;
    const fg = tone === 'success' ? p.emeraldText : tone === 'danger' ? p.dangerText : p.muted;
    return <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 8, backgroundColor: bg, borderWidth: 1, borderColor: tone === 'neutral' ? p.line : bg }}>
      <Label style={{ color: fg, fontFamily: 'BeVietnamBold' }}>{tone === 'success' ? '✓' : tone === 'danger' ? '!' : 'i'}</Label>
      <Label style={{ flex: 1, fontSize: 13, lineHeight: 20, color: p.text }}>{text}</Label>
    </View>;
  }
}
