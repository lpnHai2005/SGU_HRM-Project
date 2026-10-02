import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
export type PendingAttendance = { createdAt: number; path: string; body: { request_id: string; photo_token: string; latitude: number; longitude: number; accuracy_meters: number; captured_at: string; shift_id: number } };
const key = (employee: number) => `techzone.pending.${employee}`;
const memory = new Map<number, PendingAttendance>();
export async function savePending(employee: number, value: PendingAttendance) {
  if (Platform.OS !== 'web') await SecureStore.setItemAsync(key(employee), JSON.stringify(value));
  memory.set(employee, value);
}
export async function loadPending(employee: number): Promise<PendingAttendance | null> {
  if (Platform.OS === 'web') return memory.get(employee) || null;
  const value = await SecureStore.getItemAsync(key(employee));
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!parsed.body?.request_id || !['/mobile-attendance/check-in','/mobile-attendance/check-out'].includes(parsed.path) || !Number.isFinite(parsed.createdAt)) throw new Error('Yêu cầu đang chờ không hợp lệ. Liên hệ hỗ trợ trước khi chấm công tiếp.');
  return parsed;
}
export async function clearPending(employee: number) {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key(employee));
  memory.delete(employee);
}
