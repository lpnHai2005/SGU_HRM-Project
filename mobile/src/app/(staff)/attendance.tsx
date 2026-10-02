import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Modal, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { useSession } from '@/contexts/session';
import { Button, Card, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { distanceMeters } from '@/services/geofence';
import { AttendanceMap } from '@/components/attendance-map';
import { ensureLocationPermission } from '@/services/location-permission';
import { ApiError, displayTime, request, scheduleLabels, type Fence, type Shift, type Today } from '@/services/attendance';

import { statusLabels } from '@/services/staff';
import { savePending, loadPending, clearPending, type PendingAttendance as Pending } from '@/services/pending-attendance';

export default function AttendanceScreen() {
  const { token, ready, signOut } = useSession();
  const p = usePalette();
  const [profile, setProfile] = useState<{ employee_id?: number; full_name?: string; employee_code?: string; store_name?: string; department_name?: string; position_name?: string } | null>(null);
  const [showGps, setShowGps] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const [today, setToday] = useState<Today | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [fence, setFence] = useState<Fence | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const [needsSettings, setNeedsSettings] = useState(false);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [position, setPosition] = useState<{ latitude: number; longitude: number }>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingReady, setPendingReady] = useState(false);
  const lock = useRef(false);
  const deadline = useRef(0);
  const onError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'Không hoàn tất thao tác.');
    if (e instanceof ApiError && e.status === 401) void signOut();
  }, [signOut]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const [state, list, me] = await Promise.all([request<Today>('/attendances/today-status', token), request<Shift[]>('/attendances/shifts', token), request<NonNullable<typeof profile>>('/auth/me', token)]);
      setProfile(me);
      setToday(state); setShifts(list); setFresh(true);
      setShiftId(previous => previous ?? (list.some(s => s.shift_id === state.shift_id) ? state.shift_id : null));
      const wait = state.can_check_out ? state.checkout_seconds_remaining || 0 : state.cooldown_seconds_remaining;
      deadline.current = performance.now() + wait * 1000;
      setRemaining(wait);
      try { setFence(await request<Fence>('/mobile-attendance/geofence', token)); }
      catch (e) { setFence(null); setError(e instanceof Error ? e.message : 'Không tải được vùng chấm công.'); }
    } catch (e) {
      setFresh(false);
      setError(e instanceof Error ? e.message : 'Không tải được trạng thái.');
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally { setRefreshing(false); }
  }, [token, signOut]);

  useFocusEffect(useCallback(() => {
    if (!token) { setToday(null); setProfile(null); setPhoto(null); setPosition(undefined); setShowGps(false); setPending(null); setFresh(false); setError(''); setNotice(''); return; }
    void refresh();
    const appState = AppState.addEventListener('change', state => { if (state === 'active' && !lock.current) void refresh(); });
    const poll = setInterval(() => { if (AppState.currentState === 'active' && !lock.current) void refresh(); }, 30000);
    const tick = setInterval(() => { setRemaining(Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000))); setClock(Date.now()); }, 1000);
    return () => { appState.remove(); clearInterval(poll); clearInterval(tick); };
  }, [token, refresh]));

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
            if (active) { setPending(null); setNotice('Đã khôi phục kết quả chấm công trước khi đóng app.'); }
          }
        } catch (e) { if (active) onError(e); }
      }
      if (active) setPendingReady(true);
    }).catch(onError);
    return () => { active = false; };
  }, [profile?.employee_id, onError, token]);
  async function discardPending() {
    if (profile?.employee_id) await clearPending(profile.employee_id);
    setPending(null);
  }
  async function capture() {
    setError('');
    try {
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Cần quyền camera để chụp ảnh minh chứng. Mở quyền trong Cài đặt điện thoại.');
      const result = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: .6, allowsEditing: false, mediaTypes: ['images'] });
      if (!result.canceled) { setPhoto(result.assets[0]); setPending(null); }
    } catch (e) { onError(e); }
  }
  async function locate() {
    setStage('Đang lấy vị trí GPS…');
    const permission = await ensureLocationPermission(Location);
    setNeedsSettings(!permission.granted && !permission.canAskAgain);
    if (!permission.granted) throw new Error(permission.canAskAgain
      ? 'Cần quyền vị trí để chấm công. Cho phép vị trí khi thử lại.'
      : 'Quyền vị trí đã bị chặn. Mở Cài đặt → Expo Go → Quyền → Vị trí.');
    if (!(await Location.hasServicesEnabledAsync())) throw new Error('GPS đang tắt. Bật dịch vụ vị trí rồi thử lại.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gps = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Lấy GPS quá lâu. Ra nơi thoáng, kiểm tra quyền vị trí rồi thử lại.')), 20000); }),
    ]).finally(() => clearTimeout(timer));
    setPosition({ latitude: gps.coords.latitude, longitude: gps.coords.longitude });
    setGpsAccuracy(gps.coords.accuracy);
    return gps;
  }
  async function relocate() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await locate(); } catch (e) { onError(e); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(checkOut: boolean, retry = false) {
    if (lock.current || !token || !pendingReady || !profile?.employee_id) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    let command = retry ? pending : null;
    try {
      if (command) {
        setStage('Đang kiểm tra kết quả yêu cầu trước…');
        const outcome = await request<{ state: string; result?: { message?: string } }>(`/mobile-attendance/requests/${command.body.request_id}`, token);
        if (outcome.state === 'SUCCESS') {
          await discardPending(); setPhoto(null); setNotice(outcome.result?.message || 'Yêu cầu trước đã được ghi nhận.'); await refresh(); return;
        }
        if (outcome.state !== 'NOT_FOUND' || Date.now() - command.createdAt > 120000) {
          await discardPending(); setPhoto(null); throw new Error('Yêu cầu cũ chưa thành công hoặc minh chứng đã hết hạn. Chụp ảnh và lấy GPS mới.');
        }
      }
      if (!command) {
        if (!photo) throw new Error('Chụp ảnh selfie trước khi chấm công.');
        if (!checkOut && !shiftId) throw new Error('Chọn ca làm việc thực tế.');
        const gps = await locate();
        const { latitude, longitude, accuracy } = gps.coords;
        if (!fence) throw new Error('Chưa tải được vùng chấm công.');
        if (!accuracy || accuracy > Math.min(100, fence.radius_meters) || distanceMeters(gps.coords, fence) > fence.radius_meters) {
          setShowGps(true);
          throw new Error('Vị trí GPS chưa đạt yêu cầu. Kiểm tra khoảng cách và độ chính xác trên bản đồ.');
        }
        setShowGps(false);
        const form = new FormData();
        if (Platform.OS === 'web') form.append('file', await (await fetch(photo.uri)).blob(), 'selfie.jpg');
        else form.append('file', { uri: photo.uri, name: 'selfie.jpg', type: 'image/jpeg' } as unknown as Blob);
        setStage('Đang tải ảnh minh chứng…');
        const upload = await request<{ photo_token: string }>('/mobile-attendance/photo', token, undefined, form);
        command = { createdAt: Date.now(), path: `/mobile-attendance/${checkOut ? 'check-out' : 'check-in'}`, body: { request_id: Crypto.randomUUID(), photo_token: upload.photo_token, latitude, longitude, accuracy_meters: accuracy, captured_at: new Date(gps.timestamp).toISOString(), shift_id: shiftId || 1 } };
        await savePending(profile.employee_id, command);
        setPending(command);
      }
      setStage('Đang xác nhận với máy chủ…');
      const result = await request<{ message: string; schedule_status?: string }>(command.path, token, command.body);
      await discardPending(); setPhoto(null);
      setNotice(`${result.message}${result.schedule_status ? ` · ${scheduleLabels[result.schedule_status] || result.schedule_status}` : ''}`);
      await refresh();
    } catch (e) {
      setNotice(''); onError(e);
      if (e instanceof ApiError && e.status < 500 && ![401,403,404].includes(e.status)) {
        await discardPending();
        if (e.status === 422 || e.status === 409) setPhoto(null);
        if (e.status === 422 && /GPS|vị trí/i.test(e.message)) setShowGps(true);
        if (e.status === 429) deadline.current = performance.now() + e.retryAfter * 1000;
      }
      await refresh();
    } finally { lock.current = false; setBusy(false); }
  }

  const distance = fence && position ? distanceMeters(position, fence) : null;
  const elapsed = today?.can_check_out && today.check_in_time ? Math.max(0, Math.floor((clock - new Date(today.check_in_time).getTime()) / 1000)) : 0;
  if (!ready) return <ActivityIndicator style={{ margin: 40 }} />;
  if (!token) return <Redirect href="/login" />;
  return <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={token ? <RefreshControl refreshing={refreshing} onRefresh={() => { setError(''); void refresh(); }} tintColor={p.accent} /> : undefined}>
    <LoadingBar active={busy || refreshing} label={busy ? stage || 'Đang đăng nhập…' : 'Đang đồng bộ dữ liệu…'} />
    <View><Label muted>TECHZONE / NHÂN SỰ</Label><Label large>Chấm công</Label><Label muted>Chấm công minh bạch · Giờ Việt Nam</Label></View>
    {!!error && <Card><Text accessibilityRole="alert" style={{ color: p.danger }}>{error}</Text></Card>}
    {needsSettings && <Button title="Mở Cài đặt cấp quyền vị trí" onPress={() => void Linking.openSettings().catch(onError)} secondary />}
    {!!notice && <Card><Label>{notice}</Label></Card>}
    <Modal visible={showGps && !!fence && !!position} animationType="slide" onRequestClose={() => setShowGps(false)}>
      <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={[styles.content, { paddingTop: 52 }]}>
        <Label large>Kiểm tra vị trí chấm công</Label>
        <Card><Label>{distance !== null && fence && distance > fence.radius_meters ? 'GPS của bạn đang ngoài vùng cho phép' : gpsAccuracy && fence && gpsAccuracy <= Math.min(100, fence.radius_meters) ? 'Vị trí đang trong vùng — quay lại để xác nhận' : 'Kiểm tra độ chính xác GPS'}</Label>
          {fence && <AttendanceMap fence={fence} position={position} />}
          <Label>{fence?.store_name}</Label>
          <Label>Khoảng cách: {distance?.toFixed(0) ?? '—'} m · Bán kính: {fence?.radius_meters} m</Label>
          <Label muted>GPS của bạn: {position?.latitude.toFixed(6)}, {position?.longitude.toFixed(6)}</Label>
          <Label muted>Độ chính xác: ±{gpsAccuracy?.toFixed(0) ?? '—'} m. Vào đúng vùng và lấy lại vị trí trước khi xác nhận.</Label>
          <LoadingBar active={busy} label="Đang lấy lại vị trí…" />
          {!!error && <Text style={{ color: p.danger }}>{error}</Text>}
          <Button title="Lấy lại vị trí" onPress={() => void relocate()} disabled={busy} />
          <Button title="Quay lại chấm công" onPress={() => setShowGps(false)} secondary disabled={busy} />
        </Card>
      </ScrollView>
    </Modal>
      <Card><Label large>{profile?.full_name || 'Nhân viên TechZone'}</Label><Label muted>{profile?.employee_code || '—'} · {profile?.position_name || 'Nhân viên'}</Label><Label muted>{profile?.department_name || '—'} · {profile?.store_name || 'Chưa gán cửa hàng'}</Label></Card>
      <Card>
        <Label large>{today?.can_check_out ? 'Đang làm việc' : remaining > 0 ? `Chờ ${remaining}s` : 'Sẵn sàng cho lượt mới'}</Label>
        <Label>Ngày công: {today?.work_date || '—'} · Lượt #{today?.attendance_id || '—'}</Label>
        <Label>{today?.shift_name || 'Chưa có ca'} · {fence?.store_name || profile?.store_name || '—'}</Label>
        {today?.attendance_context?.actual && <Label muted>Ca đã lưu: {today.attendance_context.actual.start_time.slice(0, 5)}–{today.attendance_context.actual.end_time.slice(0, 5)} · Chuẩn {today.attendance_context.actual.work_hours} giờ</Label>}
        <Label>Vào: {displayTime(today?.check_in_time || null)}</Label>
        <Label>Ra: {displayTime(today?.check_out_time || null)}</Label>
        {today?.can_check_out && <Label>Đang làm: {String(Math.floor(elapsed / 3600)).padStart(2,'0')}:{String(Math.floor(elapsed / 60) % 60).padStart(2,'0')}:{String(elapsed % 60).padStart(2,'0')} · tạm tính trên thiết bị</Label>}
        <Label muted>{today?.schedule_status ? scheduleLabels[today.schedule_status] : 'Đang tải trạng thái…'}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
          <View><Label large>{Number(today?.actual_work_hours || 0).toFixed(2)}</Label><Label muted>Giờ đã ghi nhận</Label></View>
          <View><Label large>{today?.late_minutes || 0}</Label><Label muted>Phút muộn</Label></View>
          <View><Label large>{today?.early_minutes || 0}</Label><Label muted>Phút về sớm</Label></View>
          <View><Label large>{Number(today?.overtime_hours || 0).toFixed(2)}</Label><Label muted>Giờ OT</Label></View>
        </View><Label muted>Trạng thái: {statusLabels[today?.status || ''] || 'Chưa xác định'}. Giờ công cuối cùng được tính khi check-out.</Label>
        <Label muted>Mỗi lượt tối thiểu 60 giây; check-in lại sau ít nhất 60 giây kể từ check-out.</Label>
        {!fresh && <Button title="Tải lại trạng thái" onPress={() => void refresh()} secondary />}
      </Card>
      {!today?.can_check_out && <Card><Label>Chọn ca thực tế</Label>{shifts.map(s => <Button key={s.shift_id} title={`${shiftId === s.shift_id ? '✓ ' : ''}${s.shift_name} · ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`} onPress={() => setShiftId(s.shift_id)} secondary={shiftId !== s.shift_id} disabled={busy || !!pending} />)}<Label muted>Chưa có lịch hoặc khác ca được phân vẫn được ghi nhận và đánh dấu để đối soát.</Label></Card>}
      <Card><Label>{fence?.store_name || 'Vùng chấm công'}</Label><Label muted>{fence ? `Bán kính cho phép: ${fence.radius_meters} m. Vị trí được lấy khi bạn gửi chấm công.` : 'Cần cấu hình vùng cửa hàng trên máy chủ.'}</Label>{fence && <AttendanceMap fence={fence} position={position} />}</Card>
      <Card><Label>Ảnh minh chứng</Label><Label muted>Ảnh được gửi tới Cloudinary qua máy chủ khi bạn xác nhận chấm công. Không nhận diện khuôn mặt tự động.</Label>{photo && <Image source={{ uri: photo.uri }} style={{ height: 240, borderRadius: 12 }} resizeMode="cover" />}<Button title={photo ? 'Chụp lại selfie' : 'Mở camera selfie'} onPress={() => void capture()} secondary disabled={busy || !!pending} />
        {pending ? <><Label muted>Chưa chắc máy chủ đã nhận yêu cầu. Thử lại cùng mã yêu cầu để tránh tạo hai lượt.</Label><Button title="Kiểm tra / thử lại yêu cầu" onPress={() => void submit(false, true)} disabled={busy} /></> : <Button title={busy ? 'Đang xử lý…' : remaining > 0 ? `${today?.can_check_out ? 'Check-out' : 'Check-in lượt mới'} sau ${remaining}s` : today?.can_check_out ? 'Xác nhận check-out' : 'Xác nhận check-in'} onPress={() => void submit(!!today?.can_check_out)} disabled={busy || !pendingReady || !fresh || !fence || !photo || remaining > 0 || (!today?.can_check_out && !shiftId)} />}
      </Card>
      <Link href="./summary" asChild><Text style={{ color: p.accent, fontFamily: 'BeVietnamBold', padding: 12 }}>Bảng công tháng & quy định →</Text></Link>
      <Link href="./activity" asChild><Text style={{ color: p.accent, fontSize: 17, fontWeight: '700', padding: 12 }}>Xem lịch sử chấm công →</Text></Link>
      <Button title="Đăng xuất" onPress={() => void signOut().catch(onError)} secondary disabled={busy} />
  </ScrollView>;
}
