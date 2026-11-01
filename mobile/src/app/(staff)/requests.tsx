import { AppIcon, AppText as Text } from '@/components/app-icon';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useSession } from '@/contexts/session';
import { useNotifications } from '@/contexts/notifications';
import { ApiError, request } from '@/services/attendance';
import type { Profile } from '@/services/staff';
import { storeLabel } from '@/services/presentation';
import { OvertimeManagement } from '@/components/overtime-management';
import {
  fetchLeaveTypes,
  fetchLeaveBalance,
  fetchMyLeaves,
  fetchManagerPendingLeaves,
  submitLeave,
  storeApproveLeave,
  hrApproveLeave,
  rejectLeave,
  cancelLeave,
  leaveStatusMeta,
  type LeaveType,
  type LeaveBalance,
  type LeaveRequestItem,
  type LeaveStatusNotification,
} from '@/services/leaves';

// Helper: Format YYYY-MM-DD or ISO timestamp to dd-mm-yyyy
export function formatDateDMY(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr.trim())) {
    return dateStr.trim();
  }
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch {}
  return dateStr;
}

// Helper: Parse DD-MM-YYYY into { year, month, day }
export function parseDMY(str: string): { year: number; month: number; day: number } | null {
  if (!str) return null;
  const match = str.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // 0-indexed
  const year = parseInt(match[3], 10);
  const testDate = new Date(year, month, day);
  if (testDate.getFullYear() === year && testDate.getMonth() === month && testDate.getDate() === day) {
    return { year, month, day };
  }
  return null;
}

// Helper: Format Date object to DD-MM-YYYY string
export function formatDateToDMY(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Helper: Compare two DD-MM-YYYY date strings: < 0 if a < b, 0 if a == b, > 0 if a > b
export function compareDMY(aStr: string, bStr: string): number {
  const a = parseDMY(aStr);
  const b = parseDMY(bStr);
  if (!a || !b) return 0;
  const tA = new Date(a.year, a.month, a.day).getTime();
  const tB = new Date(b.year, b.month, b.day).getTime();
  return tA - tB;
}

// Helper: Count inclusive days between two DD-MM-YYYY date strings
export function countDaysBetweenDMY(startStr: string, endStr: string): number {
  const a = parseDMY(startStr);
  const b = parseDMY(endStr);
  if (!a || !b) return 1;
  const tA = new Date(a.year, a.month, a.day).getTime();
  const tB = new Date(b.year, b.month, b.day).getTime();
  if (tB < tA) return 1;
  return Math.round((tB - tA) / (1000 * 3600 * 24)) + 1;
}

// Helper: Convert DD-MM-YYYY to ISO YYYY-MM-DD for backend API
export function toISODateString(dateStr: string): string {
  const parsed = parseDMY(dateStr);
  if (parsed) {
    const m = String(parsed.month + 1).padStart(2, '0');
    const d = String(parsed.day).padStart(2, '0');
    return `${parsed.year}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    return dateStr.trim();
  }
  return dateStr;
}

// Helper: Format date time to dd-mm-yyyy HH:mm
export function formatDateTimeDMY(dateTimeStr: string | null | undefined): string {
  if (!dateTimeStr) return '—';
  try {
    const d = new Date(dateTimeStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hour = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${day}-${month}-${year} ${hour}:${min}`;
    }
  } catch {}
  return formatDateDMY(dateTimeStr);
}

export default function RequestsScreen() {
  const p = usePalette();
  const { token, signOut } = useSession();

  // 1. Profile & Roles
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // 2. Leave Types & Balance
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);

  // 3. Lists
  const [myLeaves, setMyLeaves] = useState<LeaveRequestItem[]>([]);
  const [managerLeaves, setManagerLeaves] = useState<LeaveRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // 4. Navigation & Search & Filters
  const [domainTab, setDomainTab] = useState<'leaves' | 'overtime'>('leaves');
  const [otScopeTab, setOtScopeTab] = useState<'my_ot' | 'manager_ot'>('my_ot');
  const [showCreateOtModal, setShowCreateOtModal] = useState(false);

  // Hiệu ứng nút "Đăng ký OT" trượt từ bên phải vào màn hình khi chuyển tab
  const slideAnim = useRef(new Animated.Value(200)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const triggerButtonSlideIn = useCallback(() => {
    slideAnim.setValue(200);
    opacityAnim.setValue(0);
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 6,
        tension: 45,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideAnim, opacityAnim]);

  useEffect(() => {
    if (domainTab === 'overtime') {
      triggerButtonSlideIn();
    }
  }, [domainTab, otScopeTab, triggerButtonSlideIn]);
  const [activeTab, setActiveTab] = useState<'my_leaves' | 'manager_approvals'>('my_leaves');
  const [myStatusFilter, setMyStatusFilter] = useState<string>('ALL');
  const [mgrStatusFilter, setMgrStatusFilter] = useState<string>('PENDING_ONLY');
  const [searchQuery, setSearchQuery] = useState('');

  // Month Filter State (with horizontal scroll pills)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // 5. Submit Form Popup Overlay State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalDays, setTotalDays] = useState('1');
  const [reason, setReason] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  // Calendar Picker State inside Create Modal
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calTarget, setCalTarget] = useState<'start' | 'end'>('start');
  const todayDMY = useMemo(() => formatDateToDMY(new Date()), []);

  // Compute 7-column calendar days grid for selected month/year
  const calendarDays = useMemo(() => {
    const firstDate = new Date(calYear, calMonth, 1);
    const dayOfWeek = firstDate.getDay(); // 0 is Sunday, 1 is Monday ...
    const leadingBlanks = (dayOfWeek + 6) % 7; // Monday = 0 offset
    const totalDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

    const days: ({ day: number; dateStr: string } | null)[] = [];
    for (let i = 0; i < leadingBlanks; i++) {
      days.push(null);
    }
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateStr = `${String(d).padStart(2, '0')}-${String(calMonth + 1).padStart(2, '0')}-${calYear}`;
      days.push({ day: d, dateStr });
    }
    return days;
  }, [calYear, calMonth]);

  // Calendar day selection handler
  const handleSelectCalendarDay = (dayStr: string) => {
    if (calTarget === 'start') {
      setStartDate(dayStr);
      if (!endDate || compareDMY(dayStr, endDate) > 0) {
        setEndDate(dayStr);
        setTotalDays('1');
      } else {
        setTotalDays(String(countDaysBetweenDMY(dayStr, endDate)));
      }
      setCalTarget('end');
    } else {
      if (!startDate || compareDMY(dayStr, startDate) < 0) {
        setStartDate(dayStr);
        setEndDate(dayStr);
        setTotalDays('1');
        setCalTarget('end');
      } else {
        setEndDate(dayStr);
        setTotalDays(String(countDaysBetweenDMY(startDate, dayStr)));
      }
    }
  };

  // Open create modal with fresh/current date default
  const handleOpenCreateModal = () => {
    const now = new Date();
    if (!startDate || !endDate) {
      const todayStr = formatDateToDMY(now);
      setStartDate(todayStr);
      setEndDate(todayStr);
      setTotalDays('1');
    }
    setCalYear(now.getFullYear());
    setCalMonth(now.getMonth());
    setCalTarget('start');
    setShowCreateModal(true);
  };

  // 6. View Detail Modal State (Eye icon 👁️)
  const [detailItem, setDetailItem] = useState<LeaveRequestItem | null>(null);

  // 7. Manager Approval / Rejection Action State
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestItem | null>(null);
  const [modalMode, setModalMode] = useState<'approve' | 'reject' | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');

  // 8. Notifications & Alerts State
  const { dispatchNotification } = useNotifications();
  const previousStatusMap = useRef<Record<number, string>>({});
  const isFirstLoad = useRef(true);
  const lock = useRef(false);

  // Manager determination
  const userRoles = useMemo(() => profile?.roles || [], [profile]);
  const isStoreManager = userRoles.includes('STORE_MANAGER');
  const isHrManager = userRoles.includes('HR_MANAGER');
  const isAdmin = userRoles.includes('ADMIN');
  const isManager = isStoreManager || isHrManager || isAdmin;

  // Selected leave type details
  const selectedTypeInfo = useMemo(() => {
    return types.find(t => t.leave_type_id === selectedTypeId) || null;
  }, [types, selectedTypeId]);

  // Generate 12 months for horizontal scroll pills
  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: 'ALL', label: 'Tất cả các tháng' },
    ];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const lbl = `Tháng ${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      options.push({ value: val, label: lbl });
    }
    return options;
  }, []);

  // Load Profile
  const loadProfile = useCallback(async () => {
    if (!token) return;
    setProfileLoading(true);
    try {
      const data = await request<Profile>('/auth/me', token);
      setProfile(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally {
      setProfileLoading(false);
    }
  }, [token, signOut]);

  // Load Leave Data
  const loadLeaveData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [typeList, userBalance, myItems] = await Promise.all([
        fetchLeaveTypes(token),
        fetchLeaveBalance(token),
        fetchMyLeaves(token, profile?.employee_id),
      ]);

      setTypes(typeList);
      if (typeList.length > 0 && selectedTypeId === null) {
        setSelectedTypeId(typeList[0].leave_type_id);
      }
      setBalance(userBalance);
      setMyLeaves(myItems);

      // Check for status updates to trigger notifications
      if (myItems && myItems.length > 0) {
        const newNotifs: LeaveStatusNotification[] = [];
        myItems.forEach(item => {
          const oldStatus = previousStatusMap.current[item.request_id];
          if (oldStatus && oldStatus !== item.status) {
            let msg = '';
            if (item.status === 'HR_APPROVED') {
              msg = `Đơn ${item.leave_type_name} (${formatDateDMY(item.start_date)} → ${formatDateDMY(item.end_date)}) đã được phê duyệt chính thức!`;
            } else if (item.status === 'STORE_APPROVED') {
              msg = `Đơn ${item.leave_type_name} đã được CHT duyệt Cấp 1, chuyển Phòng Nhân sự phê duyệt.`;
            } else if (item.status === 'REJECTED') {
              msg = `Đơn ${item.leave_type_name} bị từ chối: ${item.rejection_reason || 'Không chấp thuận'}.`;
            } else if (item.status === 'CANCELLED') {
              msg = `Đơn ${item.leave_type_name} của bạn đã được hủy thành công.`;
            }
            if (msg) {
              const notif: LeaveStatusNotification = {
                id: `${item.request_id}-${item.status}-${Date.now()}`,
                requestId: item.request_id,
                leaveTypeName: item.leave_type_name,
                startDate: item.start_date,
                endDate: item.end_date,
                oldStatus,
                newStatus: item.status,
                message: msg,
                timestamp: Date.now(),
                read: false,
              };
              newNotifs.push(notif);
            }
          }
          previousStatusMap.current[item.request_id] = item.status;
        });

        if (newNotifs.length > 0 && !isFirstLoad.current) {
          newNotifs.forEach(notifItem => {
            void dispatchNotification({
              type: 'leave_status',
              title: 'Cập nhật đơn nghỉ phép',
              body: notifItem.message,
              actionUrl: '/(staff)/requests',
              data: { requestId: notifItem.requestId, status: notifItem.newStatus },
            });
          });
        }
        isFirstLoad.current = false;
      }

      // If manager: fetch pending manager requests
      if (isManager) {
        const mgrItems = await fetchManagerPendingLeaves(token);
        setManagerLeaves(mgrItems);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu nghỉ phép.');
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally {
      setLoading(false);
    }
  }, [token, profile, selectedTypeId, isManager, signOut, dispatchNotification]);

  useFocusEffect(useCallback(() => { void loadProfile(); }, [loadProfile]));

  useFocusEffect(useCallback(() => { if (profile) void loadLeaveData(); }, [profile, loadLeaveData]));

  // Auto calculate total days when dates change (DD-MM-YYYY)
  const calculateDays = (startStr: string, endStr: string) => {
    const p1 = parseDMY(startStr);
    const p2 = parseDMY(endStr);
    if (!p1 || !p2) return;
    const d1 = new Date(p1.year, p1.month, p1.day);
    const d2 = new Date(p2.year, p2.month, p2.day);
    if (d2 >= d1) {
      const diff = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24)) + 1);
      setTotalDays(String(diff));
    }
  };

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    calculateDays(val, endDate);
    const p = parseDMY(val);
    if (p) {
      setCalYear(p.year);
      setCalMonth(p.month);
    }
  };

  const handleEndDateChange = (val: string) => {
    setEndDate(val);
    calculateDays(startDate, val);
  };

  // Quick date presets (DD-MM-YYYY)
  const setQuickDates = (preset: 'today' | 'tomorrow' | 'next3days') => {
    const now = new Date();
    if (preset === 'today') {
      const s = formatDateToDMY(now);
      setStartDate(s);
      setEndDate(s);
      setTotalDays('1');
      setCalYear(now.getFullYear());
      setCalMonth(now.getMonth());
      setCalTarget('end');
    } else if (preset === 'tomorrow') {
      const tm = new Date(now.getTime() + 86400000);
      const s = formatDateToDMY(tm);
      setStartDate(s);
      setEndDate(s);
      setTotalDays('1');
      setCalYear(tm.getFullYear());
      setCalMonth(tm.getMonth());
      setCalTarget('end');
    } else if (preset === 'next3days') {
      const tm = new Date(now.getTime() + 86400000);
      const d3 = new Date(now.getTime() + 3 * 86400000);
      setStartDate(formatDateToDMY(tm));
      setEndDate(formatDateToDMY(d3));
      setTotalDays('3');
      setCalYear(tm.getFullYear());
      setCalMonth(tm.getMonth());
      setCalTarget('end');
    }
  };

  // Validate form in real time (DD-MM-YYYY)
  const formValidationMsg = useMemo(() => {
    if (!startDate || !endDate) return '';

    const p1 = parseDMY(startDate);
    const p2 = parseDMY(endDate);

    if (startDate.length === 10 && !p1) {
      return 'Ngày bắt đầu không hợp lệ (định dạng DD-MM-YYYY).';
    }
    if (endDate.length === 10 && !p2) {
      return 'Ngày kết thúc không hợp lệ (định dạng DD-MM-YYYY).';
    }

    if (p1 && p2) {
      const d1 = new Date(p1.year, p1.month, p1.day);
      const d2 = new Date(p2.year, p2.month, p2.day);
      if (d1 > d2) {
        return 'Ngày bắt đầu không được lớn hơn ngày kết thúc.';
      }
    }

    const numDays = Number(totalDays);
    if (!(numDays > 0)) {
      return 'Số ngày xin nghỉ phải lớn hơn 0.';
    }

    if (selectedTypeInfo) {
      if (selectedTypeInfo.type_code === 'PHEP_NAM' && balance) {
        if (numDays > balance.annual_leave_remaining) {
          return `Số ngày xin nghỉ (${numDays} ngày) vượt quá số dư phép năm còn lại (${balance.annual_leave_remaining} ngày).`;
        }
      }
      const maxAllowed = selectedTypeInfo.max_days_allowed;
      if (maxAllowed && maxAllowed > 0 && numDays > maxAllowed) {
        return `Loại nghỉ '${selectedTypeInfo.type_name}' chỉ được tối đa ${maxAllowed} ngày theo quy định.`;
      }
    }
    return '';
  }, [startDate, endDate, totalDays, selectedTypeInfo, balance]);

  // Submit Leave Request
  const handleSubmitLeave = async () => {
    if (!token || lock.current) return;

    const p1 = parseDMY(startDate);
    const p2 = parseDMY(endDate);
    if (!selectedTypeId || !p1 || !p2) {
      setError('Vui lòng chọn loại đơn và nhập ngày hợp lệ định dạng DD-MM-YYYY.');
      return;
    }
    const d1 = new Date(p1.year, p1.month, p1.day);
    const d2 = new Date(p2.year, p2.month, p2.day);
    if (d1 > d2) {
      setError('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
      return;
    }
    if (!(Number(totalDays) > 0)) {
      setError('Số ngày xin nghỉ phải lớn hơn 0.');
      return;
    }
    if (!reason.trim()) {
      setError('Vui lòng nhập lý do xin nghỉ.');
      return;
    }
    if (formValidationMsg) {
      setError(formValidationMsg);
      return;
    }
    if (selectedTypeInfo?.requires_attachment && !/^https:\/\//.test(attachmentUrl.trim())) {
      setError('Loại đơn này yêu cầu đường dẫn HTTPS tài liệu minh chứng hợp lệ.');
      return;
    }

    lock.current = true;
    setActionBusy(true);
    setError('');
    setNotice('');

    try {
      const isoStart = toISODateString(startDate);
      const isoEnd = toISODateString(endDate);

      const res = await submitLeave(token, {
        leave_type_id: selectedTypeId,
        start_date: isoStart,
        end_date: isoEnd,
        total_days: Number(totalDays),
        reason: reason.trim(),
        attachment_url: attachmentUrl.trim() || null,
      });

      setShowCreateModal(false);
      setNotice(`${res.message || 'Nộp đơn nghỉ phép thành công! Đơn đã vào quy trình chờ duyệt.'}`);
      setReason('');
      setAttachmentUrl('');
      const todayStr = formatDateToDMY(new Date());
      setStartDate(todayStr);
      setEndDate(todayStr);
      setTotalDays('1');

      void dispatchNotification({
        type: 'leave_status',
        title: 'Đã nộp đơn nghỉ phép',
        body: `Đơn #${res.request_id} (${selectedTypeInfo?.type_name || 'Nghỉ phép'}) đã gửi, đang chờ duyệt.`,
        actionUrl: '/(staff)/requests',
        data: { requestId: res.request_id, status: 'PENDING' },
      });

      await loadLeaveData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không gửi được đơn nghỉ phép.');
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally {
      lock.current = false;
      setActionBusy(false);
    }
  };

  // Cancel own request
  const handleCancelLeave = (requestItem: LeaveRequestItem) => {
    Alert.alert(
      'Xác nhận hủy đơn',
      `Bạn có chắc chắn muốn hủy đơn xin nghỉ #${requestItem.request_id} (${requestItem.leave_type_name}) không?`,
      [
        { text: 'Không', style: 'cancel' },
        {
          text: 'Hủy đơn',
          style: 'destructive',
          onPress: async () => {
            if (!token) return;
            setActionBusy(true);
            try {
              const res = await cancelLeave(token, requestItem.request_id);
              setNotice(`${res.message || 'Đã hủy đơn xin nghỉ phép thành công.'}`);
              if (detailItem?.request_id === requestItem.request_id) {
                setDetailItem(null);
              }
              await loadLeaveData();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Không hủy được đơn.');
            } finally {
              setActionBusy(false);
            }
          },
        },
      ]
    );
  };

  // Manager Approve Request
  const handleApproveRequest = async () => {
    if (!token || !selectedRequest) return;
    setActionBusy(true);
    setError('');
    try {
      let res;
      if (isStoreManager && !isAdmin && !isHrManager) {
        res = await storeApproveLeave(token, selectedRequest.request_id, actionNote);
      } else {
        res = await hrApproveLeave(token, selectedRequest.request_id, actionNote);
      }
      setNotice(`${res.message || 'Phê duyệt đơn nghỉ phép thành công!'}`);
      void dispatchNotification({
        type: 'leave_approval',
        title: isHrManager ? 'Hoàn tất duyệt Cấp 2' : 'Đã duyệt Cấp 1',
        body: `Đã phê duyệt đơn #${selectedRequest.request_id} (${selectedRequest.employee_name || 'nhân viên'}).`,
        actionUrl: '/(staff)/requests',
        data: { requestId: selectedRequest.request_id, status: isHrManager ? 'HR_APPROVED' : 'STORE_APPROVED' },
      });
      setModalMode(null);
      if (detailItem?.request_id === selectedRequest.request_id) {
        setDetailItem(null);
      }
      setSelectedRequest(null);
      setActionNote('');
      await loadLeaveData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không phê duyệt được đơn.');
    } finally {
      setActionBusy(false);
    }
  };

  // Manager Reject Request
  const handleRejectRequest = async () => {
    if (!token || !selectedRequest) return;
    if (!rejectionReasonInput.trim()) {
      setError('Vui lòng nhập lý do từ chối đơn nghỉ phép.');
      return;
    }
    setActionBusy(true);
    setError('');
    try {
      const res = await rejectLeave(token, selectedRequest.request_id, rejectionReasonInput.trim());
      setNotice(`${res.message || 'Đã từ chối đơn nghỉ phép.'}`);
      setModalMode(null);
      if (detailItem?.request_id === selectedRequest.request_id) {
        setDetailItem(null);
      }
      setSelectedRequest(null);
      setRejectionReasonInput('');
      await loadLeaveData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không từ chối được đơn.');
    } finally {
      setActionBusy(false);
    }
  };

  // Filtered lists by Month, Status, and Search Query
  const filteredMyLeaves = useMemo(() => {
    let list = myLeaves;
    if (selectedMonth !== 'ALL') {
      list = list.filter(r => r.start_date.startsWith(selectedMonth) || r.end_date.startsWith(selectedMonth));
    }
    if (myStatusFilter === 'PENDING') {
      list = list.filter(r => r.status === 'PENDING' || r.status === 'STORE_APPROVED');
    } else if (myStatusFilter === 'APPROVED') {
      list = list.filter(r => r.status === 'HR_APPROVED');
    } else if (myStatusFilter === 'REJECTED') {
      list = list.filter(r => r.status === 'REJECTED' || r.status === 'CANCELLED');
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        return (
          r.leave_type_name?.toLowerCase().includes(q) ||
          r.reason?.toLowerCase().includes(q) ||
          r.store_manager_name?.toLowerCase().includes(q) ||
          r.hr_approver_name?.toLowerCase().includes(q) ||
          r.rejection_reason?.toLowerCase().includes(q) ||
          r.rejected_by_name?.toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [myLeaves, selectedMonth, myStatusFilter, searchQuery]);

  const filteredManagerLeaves = useMemo(() => {
    let candidateList = managerLeaves.filter(r => r.employee_id !== profile?.employee_id);
    if (selectedMonth !== 'ALL') {
      candidateList = candidateList.filter(r => r.start_date.startsWith(selectedMonth) || r.end_date.startsWith(selectedMonth));
    }

    if (mgrStatusFilter === 'PENDING_ONLY') {
      if (isStoreManager && !isAdmin && !isHrManager) {
        candidateList = candidateList.filter(r => r.status === 'PENDING');
      } else {
        candidateList = candidateList.filter(r => r.status === 'PENDING' || r.status === 'STORE_APPROVED');
      }
    } else if (mgrStatusFilter === 'APPROVED') {
      candidateList = candidateList.filter(r => r.status === 'HR_APPROVED');
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      candidateList = candidateList.filter(r => {
        return (
          r.employee_name?.toLowerCase().includes(q) ||
          r.employee_code?.toLowerCase().includes(q) ||
          r.store_name?.toLowerCase().includes(q) ||
          r.department_name?.toLowerCase().includes(q) ||
          r.leave_type_name?.toLowerCase().includes(q) ||
          r.reason?.toLowerCase().includes(q) ||
          r.store_manager_name?.toLowerCase().includes(q) ||
          r.hr_approver_name?.toLowerCase().includes(q)
        );
      });
    }

    return candidateList;
  }, [managerLeaves, profile?.employee_id, selectedMonth, mgrStatusFilter, isStoreManager, isAdmin, isHrManager, searchQuery]);

  const pendingApprovalCount = useMemo(() => {
    return managerLeaves.filter(r => {
      if (r.employee_id === profile?.employee_id) return false;
      if (isStoreManager && !isAdmin && !isHrManager) return r.status === 'PENDING';
      return r.status === 'PENDING' || r.status === 'STORE_APPROVED';
    }).length;
  }, [managerLeaves, profile?.employee_id, isStoreManager, isAdmin, isHrManager]);

  // Dedicated multi-step approval progress indicator for overview cards
  const renderApprovalProgressBox = (item: LeaveRequestItem) => {
    const isStoreApproved = !!item.store_approved_at || item.status === 'STORE_APPROVED' || item.status === 'HR_APPROVED';
    const isHrApproved = !!item.hr_approved_at || item.status === 'HR_APPROVED';
    const isRejected = item.status === 'REJECTED';
    const isCancelled = item.status === 'CANCELLED';
    const isChtRejected = isRejected && (item.rejected_by_role === 'Cửa hàng trưởng' || (!item.store_approved_at && !item.hr_approved_at && item.rejected_by_name && item.rejected_by_role !== 'Phòng Nhân sự'));
    const isHrRejected = isRejected && !isChtRejected;

    type Step = 'done' | 'rejected' | 'waiting' | 'idle';
    const cht: Step = isStoreApproved ? 'done' : isChtRejected ? 'rejected' : item.status === 'PENDING' ? 'waiting' : 'idle';
    const hr: Step = isHrApproved ? 'done' : isHrRejected ? 'rejected' : item.status === 'STORE_APPROVED' ? 'waiting' : 'idle';
    const tone = (s: Step) => (s === 'done' ? p.emerald : s === 'rejected' ? p.danger : s === 'waiting' ? p.amber : p.surfaceHigh);
    const dot = (s: Step, label: string) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s === 'waiting' ? 'transparent' : tone(s), borderWidth: s === 'waiting' ? 1.5 : 0, borderColor: tone(s) }} />
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 10, color: p.muted }}>{label}</Text>
      </View>
    );
    const bar = (s: Step) => <View style={{ flex: 1, height: 1, backgroundColor: s === 'done' ? p.emerald : p.line }} />;

    // One line describing the latest step: who acted and when.
    const detail = isCancelled
      ? 'Đơn đã bị hủy bởi người nộp.'
      : isRejected
      ? `${item.rejected_by_name || (isChtRejected ? 'CHT' : 'Phòng Nhân sự')} từ chối${item.rejected_at ? ` · ${formatDateTimeDMY(item.rejected_at)}` : ''}`
      : isHrApproved
      ? `HR ${item.hr_approver_name || 'Phòng Nhân sự'} đã duyệt${item.hr_approved_at ? ` · ${formatDateTimeDMY(item.hr_approved_at)}` : ''}`
      : isStoreApproved
      ? `CHT ${item.store_manager_name || ''} đã duyệt${item.store_approved_at ? ` · ${formatDateTimeDMY(item.store_approved_at)}` : ''} · chờ HR cấp 2`
      : 'Đang chờ cửa hàng trưởng duyệt cấp 1';

    return (
      <View style={{ gap: 6, marginTop: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {dot(isCancelled ? 'idle' : 'done', 'Nộp')}
          {bar(cht)}
          {dot(cht, 'CHT')}
          {bar(hr)}
          {dot(hr, 'HR')}
        </View>
        <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: isRejected ? p.dangerText : p.muted }}>{detail}</Text>
        {isRejected && !!item.rejection_reason && (
          <Text numberOfLines={2} style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.body }}>Lý do: {item.rejection_reason}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: p.bg }}
        contentContainerStyle={[styles.content, { paddingBottom: 100 }]}
      >
      {/* One segmented control: Nghỉ phép · Tăng ca · Duyệt đơn (managers) */}
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 6, backgroundColor: p.surfaceLow }}>
        {([
          ['mine', 'Nghỉ phép', domainTab === 'leaves' && activeTab === 'my_leaves', () => { setDomainTab('leaves'); setActiveTab('my_leaves'); }],
          ['ot', 'Tăng ca', domainTab === 'overtime', () => setDomainTab('overtime')],
          ...(isManager ? [['approve', 'Duyệt đơn', domainTab === 'leaves' && activeTab === 'manager_approvals', () => { setDomainTab('leaves'); setActiveTab('manager_approvals'); }] as const] : []),
        ] as const).map(([key, label, active, select]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={select}
            style={{ flex: 1, height: 36, borderRadius: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: active ? p.line : 'transparent', backgroundColor: active ? p.card : 'transparent' }}
          >
            <Text style={{ fontFamily: active ? 'BeVietnamBold' : 'BeVietnam', fontSize: 13, color: active ? p.text : p.muted }}>{label}</Text>
            {key === 'approve' && pendingApprovalCount > 0 && (
              <View style={{ minWidth: 18, paddingHorizontal: 5, height: 18, borderRadius: 4, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: 'MonoBold', fontSize: 11, color: p.onBrand }}>{pendingApprovalCount}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {domainTab === 'leaves' ? (
        <>
      {/* FEEDBACK MESSAGES & LOADING */}
      <LoadingBar active={loading || profileLoading || actionBusy} label="Đang đồng bộ dữ liệu nghỉ phép…" />
      {!!error && (
        <Card>
          <Text style={{ color: p.danger, fontFamily: 'BeVietnam' }}>{error}</Text>
          <Button title="Thử tải lại" secondary onPress={() => void loadLeaveData()} />
        </Card>
      )}
      {!!notice && (
        <Card>
          <Label>{notice}</Label>
        </Card>
      )}

      {/* ============================================================== */}
      {/* TAB 1: ĐƠN CỦA TÔI & TÍNH TOÁN LEAVE BALANCE                   */}
      {/* ============================================================== */}
      {activeTab === 'my_leaves' && (
        <>
          {/* 1. LEAVE BALANCE */}
          {(() => {
            const total = balance ? Number(balance.annual_leave_total) : 12;
            const used = balance ? Number(balance.annual_leave_used) : 0;
            const pendingDays = balance ? Number(balance.pending_leave_days) : 0;
            const pct = (v: number) => `${total > 0 ? Math.min(100, (v / total) * 100) : 0}%` as const;
            const others = balance ? [['Ốm BHXH', balance.sick_leave_used], ['Không lương', balance.unpaid_leave_used], ['Thai sản', balance.maternity_leave_used]].filter(([, v]) => Number(v) > 0) : [];
            return (
              <Card style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>Số dư phép năm {new Date().getFullYear()}</Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                    Tiêu chuẩn <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted }}>{total}</Text> ngày{balance && balance.seniority_bonus_days > 0 ? ` (+${balance.seniority_bonus_days} thâm niên)` : ''}
                  </Text>
                </View>
                <Text style={{ fontFamily: 'MonoBold', fontSize: 32, lineHeight: 38, letterSpacing: -1, color: p.text }}>
                  {balance ? Number(balance.annual_leave_remaining).toFixed(1) : '—'}
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.body, letterSpacing: 0 }}>  ngày khả dụng</Text>
                </Text>
                <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: p.surfaceHigh }}>
                  <View style={{ width: pct(used), backgroundColor: p.text }} />
                  <View style={{ width: pct(pendingDays), backgroundColor: p.amber }} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                  <Legend color={p.text} label="Đã nghỉ" value={used.toFixed(1)} />
                  <Legend color={p.amber} label="Chờ duyệt" value={pendingDays.toFixed(1)} />
                  {others.map(([k, v]) => <Legend key={String(k)} color={p.surfaceHigh} label={String(k)} value={String(v)} />)}
                </View>
              </Card>
            );
          })()}

          {/* 2. BUTTON TO OPEN POPUP OVERLAY */}
          <Button
            title="+ Tạo đơn xin nghỉ phép mới"
            onPress={handleOpenCreateModal}
            disabled={actionBusy}
          />

          {/* 3. MY LEAVE REQUESTS SECTION */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <Label large>Lịch sử đơn của bạn</Label>
            <Text style={{ fontSize: 12, color: p.muted, fontFamily: 'BeVietnam' }}>
              {filteredMyLeaves.length} đơn
            </Text>
          </View>

          {/* SEARCH BAR (REPLACED DROPDOWN) + MONTH SCROLL PILLS */}
          <View style={{ gap: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: p.card,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: p.line,
                paddingHorizontal: 12,
              }}
            >
              <AppIcon name="search-outline" style={{ fontSize: 14, marginRight: 8 }} />
              <TextInput
                accessibilityLabel="Tìm kiếm đơn nghỉ phép"
                placeholder="Tìm theo loại nghỉ, lý do, người duyệt..."
                placeholderTextColor={p.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  fontSize: 14,
                  fontFamily: 'BeVietnam',
                  color: p.text,
                }}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={10} style={{ padding: 4 }}>
                  <AppIcon name="close-outline" style={{ fontSize: 13, color: p.muted, fontWeight: '700' }} />
                </Pressable>
              )}
            </View>

            {/* Horizontal Month Scroll Pills */}
            <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {monthOptions.map(opt => {
                const isSelected = selectedMonth === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setSelectedMonth(opt.value)}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 13,
                      borderRadius: 8,
                      backgroundColor: isSelected ? p.accent : p.card,
                      borderWidth: 1,
                      borderColor: isSelected ? p.accent : p.line,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                        fontSize: 12,
                        color: isSelected ? p.onBrand : p.text,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Status Filter Tabs */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[
              ['ALL', 'Tất cả'],
              ['PENDING', 'Chờ duyệt'],
              ['APPROVED', 'Đã duyệt'],
              ['REJECTED', 'Từ chối / Hủy'],
            ].map(([val, labelText]) => {
              const selected = myStatusFilter === val;
              return (
                <Pressable
                  key={val}
                  onPress={() => setMyStatusFilter(val)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: selected ? p.accent : p.card,
                    borderWidth: 1,
                    borderColor: selected ? p.accent : p.line,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: selected ? 'BeVietnamBold' : 'BeVietnam',
                      fontSize: 12,
                      color: selected ? p.onBrand : p.text,
                    }}
                  >
                    {labelText}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* My leave requests: whole card opens the detail sheet */}
          {filteredMyLeaves.map(item => {
            const meta = leaveStatusMeta[item.status] || {
              label: item.status,
              color: p.text,
              bg: p.card,
              step: 'Đang xử lý',
            };
            const canCancel = item.status === 'PENDING';

            return (
              <Card key={item.request_id} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, color: p.text, flex: 1 }} numberOfLines={1}>
                    {item.leave_type_name}
                  </Text>
                  <View style={{ backgroundColor: meta.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, flexShrink: 0 }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', color: meta.color, fontSize: 11 }}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={{ fontFamily: 'Mono', fontSize: 12, color: p.body }}>
                  {formatDateDMY(item.start_date)} → {formatDateDMY(item.end_date)} · {item.total_days} ngày
                </Text>
                {renderApprovalProgressBox(item)}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Xem chi tiết đơn #${item.request_id}`} hitSlop={10} onPress={() => setDetailItem(item)}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.emeraldText }}>Xem chi tiết →</Text>
                  </Pressable>
                  {canCancel && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Hủy đơn #${item.request_id}`}
                      onPress={() => handleCancelLeave(item)}
                      hitSlop={8}
                      style={({ pressed }) => ({ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line, backgroundColor: pressed ? p.dangerBg : p.card })}
                    >
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.dangerText }}>Hủy đơn</Text>
                    </Pressable>
                  )}
                </View>
              </Card>
            );
          })}

          {filteredMyLeaves.length === 0 && !loading && (
            <Card>
              <Label>Không có đơn xin nghỉ phép nào trong tháng hoặc từ khóa tìm kiếm.</Label>
            </Card>
          )}
        </>
      )}

      {/* ============================================================== */}
      {/* TAB 2: QUẢN LÝ DUYỆT ĐƠN (STORE MANAGER & HR MANAGER)          */}
      {/* ============================================================== */}
      {activeTab === 'manager_approvals' && isManager && (
        <>
          <Label large>Duyệt đơn nhân viên chi nhánh</Label>
          <Label muted>
            {isStoreManager && !isAdmin && !isHrManager
              ? 'Phê duyệt sơ bộ Cấp 1 các đơn xin nghỉ phép của nhân viên thuộc chi nhánh bạn quản lý.'
              : 'Phê duyệt chính thức Cấp 2 (toàn quyền Phòng Nhân sự / Ban Giám đốc).'}
          </Label>

          {/* Search Bar + Month Scroll for Manager */}
          <View style={{ gap: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: p.card,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: p.line,
                paddingHorizontal: 12,
              }}
            >
              <AppIcon name="search-outline" style={{ fontSize: 14, marginRight: 8 }} />
              <TextInput
                accessibilityLabel="Tìm kiếm đơn nhân viên"
                placeholder="Tìm nhân viên, mã NV, loại nghỉ, chi nhánh..."
                placeholderTextColor={p.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  fontSize: 14,
                  fontFamily: 'BeVietnam',
                  color: p.text,
                }}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={10} style={{ padding: 4 }}>
                  <AppIcon name="close-outline" style={{ fontSize: 13, color: p.muted, fontWeight: '700' }} />
                </Pressable>
              )}
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {monthOptions.map(opt => {
                const isSelected = selectedMonth === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setSelectedMonth(opt.value)}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 13,
                      borderRadius: 8,
                      backgroundColor: isSelected ? p.accent : p.card,
                      borderWidth: 1,
                      borderColor: isSelected ? p.accent : p.line,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                        fontSize: 12,
                        color: isSelected ? p.onBrand : p.text,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Filter Pills */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[
              ['PENDING_ONLY', `Cần duyệt (${pendingApprovalCount})`],
              ['APPROVED', 'Đã duyệt'],
              ['ALL', 'Tất cả'],
            ].map(([val, labelText]) => {
              const selected = mgrStatusFilter === val;
              return (
                <Pressable
                  key={val}
                  onPress={() => setMgrStatusFilter(val)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: selected ? p.accent : p.card,
                    borderWidth: 1,
                    borderColor: selected ? p.accent : p.line,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: selected ? 'BeVietnamBold' : 'BeVietnam',
                      fontSize: 12,
                      color: selected ? p.onBrand : p.text,
                    }}
                  >
                    {labelText}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Requests awaiting this manager: tap the card for details, act with the two buttons */}
          {filteredManagerLeaves.map(item => {
            const meta = leaveStatusMeta[item.status] || {
              label: item.status,
              color: p.text,
              bg: p.card,
              step: 'Đang xử lý',
            };
            const isPendingStore = item.status === 'PENDING';
            const isPendingHr = item.status === 'STORE_APPROVED';
            const canApprove =
              (isStoreManager && isPendingStore) ||
              ((isHrManager || isAdmin) && (isPendingStore || isPendingHr));
            const initials = (item.employee_name || 'NV').split(' ').slice(-2).map(w => w[0]).join('').toUpperCase();
            const cells: [string, string, boolean][] = [
              ['Loại', item.leave_type_name, false],
              ['Thời gian', item.start_date === item.end_date ? formatDateDMY(item.start_date).slice(0, 5) : `${formatDateDMY(item.start_date).slice(0, 5)}–${formatDateDMY(item.end_date).slice(0, 5)}`, true],
              ['Số ngày', String(item.total_days), true],
            ];

            return (
              <Card key={item.request_id} style={{ gap: 10 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Xem chi tiết đơn của ${item.employee_name || 'nhân viên'}`} onPress={() => setDetailItem(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.surfaceLow, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.text }}>{initials}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }} numberOfLines={1}>{item.employee_name || 'Nhân viên'}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                      <Text style={{ fontFamily: 'Mono', fontSize: 12, color: p.muted }}>{item.employee_code || `#${item.employee_id}`}</Text> · {storeLabel(item.store_name || item.department_name)}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: meta.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, flexShrink: 0 }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', color: meta.color, fontSize: 11 }}>{meta.label}</Text>
                  </View>
                  <AppIcon name="chevron-forward" size={14} color={p.muted} />
                </Pressable>

                <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: p.line, borderRadius: 6 }}>
                  {cells.map(([k, v, mono], i) => (
                    <View key={k} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderLeftWidth: i ? 1 : 0, borderLeftColor: p.line }}>
                      <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{k}</Text>
                      <Text numberOfLines={1} style={{ fontFamily: mono ? 'MonoBold' : 'BeVietnamBold', fontSize: 13, color: p.text, marginTop: 2 }}>{v}</Text>
                    </View>
                  ))}
                </View>

                {!!item.reason && <Text numberOfLines={2} style={{ fontFamily: 'BeVietnam', fontSize: 13, lineHeight: 19, color: p.body }}>{item.reason}</Text>}

                {renderApprovalProgressBox(item)}

                {canApprove && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Từ chối đơn của ${item.employee_name || 'nhân viên'}`}
                      onPress={() => {
                        setSelectedRequest(item);
                        setRejectionReasonInput('');
                        setModalMode('reject');
                      }}
                      style={({ pressed }) => ({ flex: 1, height: 42, borderRadius: 6, borderWidth: 1, borderColor: p.line, backgroundColor: pressed ? p.dangerBg : p.card, alignItems: 'center', justifyContent: 'center' })}
                    >
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.dangerText }}>Từ chối</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Duyệt đơn của ${item.employee_name || 'nhân viên'}`}
                      onPress={() => {
                        setSelectedRequest(item);
                        setActionNote(
                          isStoreManager
                            ? 'Cửa hàng trưởng đã kiểm tra ca kíp và duyệt Cấp 1.'
                            : 'Phòng Nhân sự đã phê duyệt chính thức.'
                        );
                        setModalMode('approve');
                      }}
                      style={({ pressed }) => ({ flex: 1, height: 42, borderRadius: 6, backgroundColor: p.brand, opacity: pressed ? 0.85 : 1, alignItems: 'center', justifyContent: 'center' })}
                    >
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.onBrand }}>{isPendingHr ? 'Duyệt cấp 2' : 'Duyệt'}</Text>
                    </Pressable>
                  </View>
                )}
              </Card>
            );
          })}

          {filteredManagerLeaves.length === 0 && !loading && (
            <Card>
              <Label>Không có đơn nghỉ phép nào cần xử lý trong tháng hoặc từ khóa tìm kiếm.</Label>
            </Card>
          )}
        </>
      )}

      {/* ============================================================== */}
        </>
      ) : (
        <OvertimeManagement
          token={token}
          profile={profile}
          isManager={isManager}
          isStoreManager={isStoreManager}
          isHrManager={isHrManager}
          isAdmin={isAdmin}
          monthOptions={monthOptions}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          onRefreshLeaves={loadLeaveData}
          showCreateModal={showCreateOtModal}
          setShowCreateModal={setShowCreateOtModal}
          activeScopeTab={otScopeTab}
          onScopeTabChange={setOtScopeTab}
        />
      )}

      {/* 9. POPUP OVERLAY TẠO ĐƠN NGHỈ PHÉP MỚI (CREATE LEAVE MODAL)   */}
      {/* ============================================================== */}
      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(9,9,11,0.5)',
            justifyContent: 'flex-end',
            alignItems: 'stretch',
            padding: 0,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: undefined,
              backgroundColor: p.card,
              borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomWidth: 0,
              maxHeight: '90%',
              borderWidth: 1,
              borderColor: p.line,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: p.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Label large>Nộp đơn xin nghỉ phép</Label>
                <Label muted>Hệ thống tự động kiểm soát số dư phép năm theo quy định TechZone.</Label>
              </View>
              <Pressable
                onPress={() => setShowCreateModal(false)}
                hitSlop={10}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: p.bg,
                  borderWidth: 1,
                  borderColor: p.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="close-outline" style={{ fontSize: 16, color: p.muted, fontWeight: '700' }} />
              </Pressable>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14 }} >
              {/* Leave Type Selector Chips */}
              <Label>1. Chọn loại đơn xin nghỉ</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {types.map(t => {
                  const isSelected = selectedTypeId === t.leave_type_id;
                  return (
                    <Pressable
                      key={t.leave_type_id}
                      accessibilityRole="button"
                      onPress={() => setSelectedTypeId(t.leave_type_id)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 8,
                        backgroundColor: isSelected ? p.accent : p.bg,
                        borderWidth: 1,
                        borderColor: isSelected ? p.accent : p.line,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                          fontSize: 13,
                          color: isSelected ? p.onBrand : p.text,
                        }}
                      >
                        {t.type_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Selected Type Rules Badge */}
              {selectedTypeInfo && (
                <View
                  style={{
                    backgroundColor: selectedTypeInfo.is_paid ? p.emeraldBg : p.amberBg,
                    padding: 12,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: selectedTypeInfo.is_paid ? p.emeraldBg : p.amberBg,
                    gap: 4,
                  }}
                >
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: selectedTypeInfo.is_paid ? p.emeraldText : p.amberText }}>
                    {selectedTypeInfo.is_paid ? 'Chế độ hưởng nguyên lương' : 'Nghỉ không hưởng lương (trừ vào lương tháng)'}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: selectedTypeInfo.is_paid ? p.emeraldText : p.amberText }}>
                    {selectedTypeInfo.type_code === 'PHEP_NAM'
                      ? `Số dư phép năm khả dụng: ${balance ? Number(balance.annual_leave_remaining).toFixed(1) : 12} ngày.`
                      : selectedTypeInfo.max_days_allowed && selectedTypeInfo.max_days_allowed > 0
                      ? `Hạn mức tối đa theo quy định: ${selectedTypeInfo.max_days_allowed} ngày/lần.`
                      : 'Không giới hạn ngày theo khung chuẩn.'}
                  </Text>
                  {selectedTypeInfo.requires_attachment && (
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.dangerText }}>
                      * Bắt buộc đính kèm link tài liệu minh chứng (Giấy viện, Giấy kết hôn, Đơn thôi việc).
                    </Text>
                  )}
                </View>
              )}

              {/* 2. CHỌN KHOẢNG THỜI GIAN NGHỈ */}
              <Label>2. Chọn khoảng thời gian nghỉ</Label>

              {/* Quick Presets (Clean: Hôm nay, Ngày mai, 3 ngày tới - No (1d)) */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setQuickDates('today')}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: 6,
                    backgroundColor: p.bg,
                    borderWidth: 1,
                    borderColor: p.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 13, color: p.text, fontFamily: 'BeVietnamBold' }}>Hôm nay</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setQuickDates('tomorrow')}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: 6,
                    backgroundColor: p.bg,
                    borderWidth: 1,
                    borderColor: p.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 13, color: p.text, fontFamily: 'BeVietnamBold' }}>Ngày mai</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setQuickDates('next3days')}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: 6,
                    backgroundColor: p.bg,
                    borderWidth: 1,
                    borderColor: p.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 13, color: p.text, fontFamily: 'BeVietnamBold' }}>3 ngày tới</Text>
                </Pressable>
              </View>

              {/* INTERACTIVE CALENDAR PICKER (CHỌN TRỰC TIẾP TRÊN LỊCH) */}
              <View
                style={{
                  backgroundColor: p.bg,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: p.line,
                  padding: 12,
                  gap: 10,
                }}
              >
                {/* Month navigation header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tháng trước"
                    onPress={() => {
                      setCalMonth(prev => {
                        if (prev === 0) {
                          setCalYear(y => y - 1);
                          return 11;
                        }
                        return prev - 1;
                      });
                    }}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: p.card,
                      borderWidth: 1,
                      borderColor: p.line,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <AppIcon name="chevron-back" style={{ fontSize: 16, color: p.text, fontWeight: '700' }} />
                  </Pressable>

                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>
                      Tháng {String(calMonth + 1).padStart(2, '0')}/{calYear}
                    </Text>
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                      {calTarget === 'start' ? '● Đang chọn: Ngày bắt đầu' : '● Đang chọn: Ngày kết thúc'}
                    </Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tháng sau"
                    onPress={() => {
                      setCalMonth(prev => {
                        if (prev === 11) {
                          setCalYear(y => y + 1);
                          return 0;
                        }
                        return prev + 1;
                      });
                    }}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: p.card,
                      borderWidth: 1,
                      borderColor: p.line,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <AppIcon name="chevron-forward" style={{ fontSize: 16, color: p.text, fontWeight: '700' }} />
                  </Pressable>
                </View>

                {/* Target switcher tabs */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setCalTarget('start')}
                    style={{
                      flex: 1,
                      paddingVertical: 7,
                      paddingHorizontal: 10,
                      borderRadius: 8,
                      backgroundColor: calTarget === 'start' ? p.surfaceLow : p.card,
                      borderWidth: 1.5,
                      borderColor: calTarget === 'start' ? p.accent : p.line,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 10, color: p.muted, fontFamily: 'BeVietnam' }}>Từ ngày</Text>
                      <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: startDate ? p.text : p.muted }}>
                        {startDate || 'Chưa chọn'}
                      </Text>
                    </View>
                    {calTarget === 'start' && (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent }} />
                    )}
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setCalTarget('end')}
                    style={{
                      flex: 1,
                      paddingVertical: 7,
                      paddingHorizontal: 10,
                      borderRadius: 8,
                      backgroundColor: calTarget === 'end' ? p.surfaceLow : p.card,
                      borderWidth: 1.5,
                      borderColor: calTarget === 'end' ? p.accent : p.line,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 10, color: p.muted, fontFamily: 'BeVietnam' }}>Đến ngày</Text>
                      <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: endDate ? p.text : p.muted }}>
                        {endDate || 'Chưa chọn'}
                      </Text>
                    </View>
                    {calTarget === 'end' && (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent }} />
                    )}
                  </Pressable>
                </View>

                {/* Weekdays header row */}
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: p.line, paddingBottom: 6 }}>
                  {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w, idx) => (
                    <View key={w} style={{ flex: 1, alignItems: 'center' }}>
                      <Text
                        style={{
                          fontSize: 11,
                          fontFamily: 'BeVietnamBold',
                          color: idx >= 5 ? p.amberText : p.muted,
                        }}
                      >
                        {w}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Days Grid */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {calendarDays.map((item, idx) => {
                    if (!item) {
                      return <View key={`blank-${idx}`} style={{ width: '14.28%', height: 38 }} />;
                    }

                    const isStart = startDate === item.dateStr;
                    const isEnd = endDate === item.dateStr;
                    const isInRange = Boolean(
                      startDate &&
                      endDate &&
                      compareDMY(item.dateStr, startDate) > 0 &&
                      compareDMY(item.dateStr, endDate) < 0
                    );
                    const isSingle = isStart && isEnd;
                    const isSelected = isStart || isEnd;
                    const isToday = todayDMY === item.dateStr;

                    return (
                      <Pressable
                        key={item.dateStr}
                        accessibilityRole="button"
                        accessibilityLabel={`Ngày ${item.day}`}
                        onPress={() => handleSelectCalendarDay(item.dateStr)}
                        style={{
                          width: '14.28%',
                          height: 38,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isInRange
                            ? p.surfaceHigh
                            : isSelected && !isSingle
                            ? p.surfaceHigh
                            : 'transparent',
                          borderTopLeftRadius: isStart ? 19 : 0,
                          borderBottomLeftRadius: isStart ? 19 : 0,
                          borderTopRightRadius: isEnd ? 19 : 0,
                          borderBottomRightRadius: isEnd ? 19 : 0,
                        }}
                      >
                        <View
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: isSelected ? p.accent : 'transparent',
                            borderWidth: isToday && !isSelected ? 1.5 : 0,
                            borderColor: isToday && !isSelected ? p.accent : 'transparent',
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                              fontSize: 12,
                              color: isSelected
                                ? p.onBrand
                                : isInRange
                                ? p.brandText
                                : p.text,
                            }}
                          >
                            {item.day}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Direct date inputs (Clean title without dd-mm-yyyy, placeholder DD-MM-YYYY) */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Label muted>Từ ngày</Label>
                  <Input
                    placeholder="DD-MM-YYYY"
                    accessibilityLabel="Từ ngày"
                    value={startDate}
                    onChangeText={handleStartDateChange}
                    maxLength={10}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Label muted>Đến ngày</Label>
                  <Input
                    placeholder="DD-MM-YYYY"
                    accessibilityLabel="Đến ngày"
                    value={endDate}
                    onChangeText={handleEndDateChange}
                    maxLength={10}
                  />
                </View>
              </View>

              <Label>Số ngày xin nghỉ</Label>
              <Input
                placeholder="Số ngày (vd: 1, 0.5, 2)"
                accessibilityLabel="Số ngày nghỉ"
                value={totalDays}
                onChangeText={setTotalDays}
                keyboardType="decimal-pad"
              />

              {/* Real-time validation warning */}
              {!!formValidationMsg && (
                <Text style={{ color: p.danger, fontFamily: 'BeVietnamBold', fontSize: 13 }}>
                  <AppIcon name="warning-outline" size={14} /> {formValidationMsg}
                </Text>
              )}

              <Label>Lý do xin nghỉ (*)</Label>
              <Input
                placeholder="Nhập lý do cụ thể gửi cấp quản lý phê duyệt..."
                accessibilityLabel="Lý do xin nghỉ"
                multiline
                numberOfLines={3}
                value={reason}
                onChangeText={setReason}
              />

              <Label>Tài liệu minh chứng (URL)</Label>
              <Input
                placeholder="Link HTTPS ảnh chụp giấy viện / chứng từ (nếu có)"
                accessibilityLabel="Tài liệu minh chứng"
                value={attachmentUrl}
                onChangeText={setAttachmentUrl}
                autoCapitalize="none"
              />

              <View style={{ marginTop: 8, gap: 10 }}>
                <Button
                  title={actionBusy ? 'Đang gửi đơn…' : 'Gửi đơn xin nghỉ'}
                  onPress={() => void handleSubmitLeave()}
                  disabled={actionBusy || !!formValidationMsg || !startDate || !endDate || !reason.trim()}
                />
                <Button title="Hủy bỏ" secondary onPress={() => setShowCreateModal(false)} disabled={actionBusy} />
              </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============================================================== */}
      {/* 10. MODAL XEM CHI TIẾT ĐƠN (REFINED LAYOUT & ALIGNMENT)        */}
      {/* ============================================================== */}
      <Modal visible={!!detailItem} transparent animationType="slide" onRequestClose={() => setDetailItem(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(9,9,11,0.5)',
            justifyContent: 'flex-end',
            alignItems: 'stretch',
            padding: 0,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: undefined,
              backgroundColor: p.card,
              borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomWidth: 0,
              maxHeight: '90%',
              borderWidth: 1,
              borderColor: p.line,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: p.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Label large>Chi tiết Đơn nghỉ phép #{detailItem?.request_id}</Label>
                <Label muted>{detailItem?.employee_name} · {detailItem?.employee_code || `#${detailItem?.employee_id}`}</Label>
              </View>
              <Pressable
                onPress={() => setDetailItem(null)}
                hitSlop={10}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: p.bg,
                  borderWidth: 1,
                  borderColor: p.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="close-outline" style={{ fontSize: 16, color: p.muted, fontWeight: '700' }} />
              </Pressable>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14 }} >
              {detailItem && (
                <>
                  {/* Status Banner */}
                  {(() => {
                    const meta = leaveStatusMeta[detailItem.status] || {
                      label: detailItem.status,
                      color: p.text,
                      bg: p.bg,
                    };
                    return (
                      <View
                        style={{
                          backgroundColor: meta.bg,
                          padding: 14,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: meta.color + '40',
                        }}
                      >
                        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 16, color: meta.color }}>
                          {meta.label}
                        </Text>
                        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: meta.color, marginTop: 4, lineHeight: 18 }}>
                          {detailItem.status === 'HR_APPROVED'
                            ? 'Đã hoàn tất phê duyệt chính thức bởi Phòng Nhân sự.'
                            : detailItem.status === 'STORE_APPROVED'
                            ? 'Cửa hàng trưởng đã duyệt Cấp 1 · Đang chờ Trưởng phòng Nhân sự duyệt Cấp 2.'
                            : detailItem.status === 'PENDING'
                            ? '⏳ Đang chờ Cửa hàng trưởng kiểm tra lịch ca trực và duyệt Cấp 1.'
                            : detailItem.status === 'REJECTED'
                            ? 'Đơn đã bị từ chối phê duyệt.'
                            : 'Đã hủy bởi người nộp đơn.'}
                        </Text>
                      </View>
                    );
                  })()}

                  {/* THÔNG TIN KỲ NGHỈ (2-Column Grid) */}
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Thông tin kỳ nghỉ
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>Loại đơn nghỉ</Text>
                        <Text style={{ fontSize: 14, fontFamily: 'BeVietnamBold', color: p.text, marginTop: 3 }}>
                          {detailItem.leave_type_name}
                        </Text>
                        <Text style={{ fontSize: 11, color: p.muted, marginTop: 2 }}>Mã đơn: #{detailItem.request_id}</Text>
                      </View>
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>Tổng thời gian</Text>
                        <Text style={{ fontSize: 14, fontFamily: 'BeVietnamBold', color: p.accent, marginTop: 3 }}>
                          {detailItem.total_days} ngày
                        </Text>
                        <Text style={{ fontSize: 11, color: p.emeraldText, fontFamily: 'BeVietnamBold', marginTop: 2 }}>
                          {formatDateDMY(detailItem.start_date)} → {formatDateDMY(detailItem.end_date)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* THÔNG TIN NHÂN SỰ (2-Column Grid) */}
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Thông tin nhân sự
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>Họ và tên</Text>
                        <Text style={{ fontSize: 14, fontFamily: 'BeVietnamBold', color: p.text, marginTop: 3 }}>
                          {detailItem.employee_name}
                        </Text>
                        <Text style={{ fontSize: 11, color: p.muted, marginTop: 2 }}>
                          {detailItem.employee_code || `NV-#${detailItem.employee_id}`}
                        </Text>
                      </View>
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>Đơn vị / Chi nhánh</Text>
                        <Text style={{ fontSize: 14, fontFamily: 'BeVietnamBold', color: p.text, marginTop: 3 }}>
                          {storeLabel(detailItem.store_name || detailItem.department_name)}
                        </Text>
                        <Text style={{ fontSize: 11, color: p.muted, marginTop: 2 }}>
                          {detailItem.position_name || 'Nhân viên'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* LÝ DO XIN NGHỈ */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Lý do xin nghỉ
                    </Text>
                    <View style={{ backgroundColor: p.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                      <Text style={{ fontSize: 13, color: p.text, fontFamily: 'BeVietnam', lineHeight: 20 }}>
                        {detailItem.reason || 'Không có ghi chú lý do.'}
                      </Text>
                    </View>
                  </View>

                  {/* TÀI LIỆU MINH CHỨNG */}
                  {!!detailItem.attachment_url && (
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Tài liệu minh chứng
                      </Text>
                      <View style={{ backgroundColor: p.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 13, color: p.indigoText, fontFamily: 'BeVietnamBold' }}>
                          <AppIcon name="link-outline" size={14} /> {detailItem.attachment_url}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* TIẾN TRÌNH PHÊ DUYỆT 2 CẤP */}
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Tiến trình phê duyệt 2 Cấp
                    </Text>
                    <View style={{ backgroundColor: p.bg, borderRadius: 8, borderWidth: 1, borderColor: p.line, padding: 14, gap: 12 }}>
                      {/* Step 1: CHT */}
                      <View style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text, flex: 1, minWidth: 130 }}>
                            Cấp 1: Cửa hàng trưởng
                          </Text>
                          <View
                            style={{
                              backgroundColor: detailItem.store_approved_at ? p.emeraldBg : detailItem.status === 'REJECTED' && detailItem.rejected_by_role === 'Cửa hàng trưởng' ? p.dangerBg : p.amberBg,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 8,
                              flexShrink: 0,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '700',
                                color: detailItem.store_approved_at ? p.emeraldText : detailItem.status === 'REJECTED' && detailItem.rejected_by_role === 'Cửa hàng trưởng' ? p.dangerText : p.amberText,
                              }}
                            >
                              {detailItem.store_approved_at ? 'Đã duyệt' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role === 'Cửa hàng trưởng' ? 'Từ chối' : '⏳ Chờ duyệt'}
                            </Text>
                          </View>
                        </View>
                        {detailItem.store_approved_at ? (
                          <View style={{ gap: 2, marginTop: 2 }}>
                            <Text style={{ fontSize: 12, color: p.muted, fontFamily: 'BeVietnam', lineHeight: 18 }}>
                              Người duyệt: <Text style={{ color: p.text, fontWeight: '700' }}>{detailItem.store_manager_name || 'Cửa hàng trưởng'}</Text>
                            </Text>
                            <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>
                              Thời gian: {formatDateTimeDMY(detailItem.store_approved_at)}
                            </Text>
                            {!!detailItem.store_manager_note && (
                              <Text style={{ fontSize: 12, color: p.text, fontStyle: 'italic', backgroundColor: p.card, padding: 8, borderRadius: 6, marginTop: 2, borderWidth: 1, borderColor: p.line }}>
                                {`Ghi chú: "${detailItem.store_manager_note}"`}
                              </Text>
                            )}
                          </View>
                        ) : (
                          <Text style={{ fontSize: 12, color: p.muted, fontFamily: 'BeVietnam', marginTop: 2, lineHeight: 17 }}>
                            Đang chờ Cửa hàng trưởng kiểm tra lịch ca trực chi nhánh và duyệt sơ bộ.
                          </Text>
                        )}
                      </View>

                      <View style={{ height: 1, backgroundColor: p.line }} />

                      {/* Step 2: HR */}
                      <View style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text, flex: 1, minWidth: 130 }}>
                            Cấp 2: Phòng Nhân sự
                          </Text>
                          <View
                            style={{
                              backgroundColor: detailItem.hr_approved_at ? p.emeraldBg : detailItem.status === 'REJECTED' && detailItem.rejected_by_role !== 'Cửa hàng trưởng' ? p.dangerBg : p.amberBg,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 8,
                              flexShrink: 0,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '700',
                                color: detailItem.hr_approved_at ? p.emeraldText : detailItem.status === 'REJECTED' && detailItem.rejected_by_role !== 'Cửa hàng trưởng' ? p.dangerText : p.amberText,
                              }}
                            >
                              {detailItem.hr_approved_at ? 'Đã duyệt' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role !== 'Cửa hàng trưởng' ? 'Từ chối' : '⏳ Chờ duyệt'}
                            </Text>
                          </View>
                        </View>
                        {detailItem.hr_approved_at ? (
                          <View style={{ gap: 2, marginTop: 2 }}>
                            <Text style={{ fontSize: 12, color: p.muted, fontFamily: 'BeVietnam', lineHeight: 18 }}>
                              Người duyệt: <Text style={{ color: p.text, fontWeight: '700' }}>{detailItem.hr_approver_name || 'Phòng Nhân sự'}</Text>
                            </Text>
                            <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>
                              Thời gian: {formatDateTimeDMY(detailItem.hr_approved_at)}
                            </Text>
                          </View>
                        ) : detailItem.status !== 'REJECTED' ? (
                          <Text style={{ fontSize: 12, color: p.muted, fontFamily: 'BeVietnam', marginTop: 2, lineHeight: 17 }}>
                            Đang chờ Trưởng phòng Nhân sự duyệt công thức tính công và trừ phép năm.
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  {/* THÔNG TIN TỪ CHỐI (NẾU CÓ) */}
                  {!!detailItem.rejection_reason && (
                    <View style={{ backgroundColor: p.dangerBg, padding: 14, borderRadius: 8, gap: 6, borderWidth: 1, borderColor: p.dangerBg }}>
                      <Text style={{ color: p.dangerText, fontFamily: 'BeVietnamBold', fontSize: 13 }}>
                        <AppIcon name="warning-outline" size={14} /> LÝ DO TỪ CHỐI ĐƠN
                      </Text>
                      <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13, lineHeight: 18 }}>
                        {detailItem.rejection_reason}
                      </Text>
                      <Text style={{ color: p.dangerText, fontSize: 12 }}>
                        Người từ chối: {detailItem.rejected_by_name || 'Quản lý'} ({detailItem.rejected_by_role || 'Cấp duyệt'}) lúc {formatDateTimeDMY(detailItem.rejected_at)}
                      </Text>
                    </View>
                  )}

                  {/* ACTIONS INSIDE DETAIL MODAL */}
                  <View style={{ gap: 10, marginTop: 6 }}>
                    {isManager && detailItem.employee_id !== profile?.employee_id && (
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            title="Duyệt đơn"
                            onPress={() => {
                              setSelectedRequest(detailItem);
                              setActionNote(isStoreManager ? 'Cửa hàng trưởng duyệt Cấp 1.' : 'Phòng Nhân sự phê duyệt.');
                              setModalMode('approve');
                            }}
                            disabled={actionBusy}
                          />
                        </View>
                        {!((detailItem.end_date || detailItem.start_date) && (detailItem.end_date || detailItem.start_date) < new Date().toISOString().slice(0, 10)) && (
                          <View style={{ flex: 1 }}>
                            <Button
                              title="Từ chối"
                              secondary
                              onPress={() => {
                                setSelectedRequest(detailItem);
                                setRejectionReasonInput('');
                                setModalMode('reject');
                              }}
                              disabled={actionBusy}
                            />
                          </View>
                        )}
                      </View>
                    )}

                    {detailItem.status === 'PENDING' && detailItem.employee_id === profile?.employee_id ? (
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                        {/* Nút hủy đơn: màu đỏ, nhỏ gọn hơn, nằm bên trái */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Hủy đơn xin nghỉ này"
                          onPress={() => handleCancelLeave(detailItem)}
                          disabled={actionBusy}
                          style={({ pressed }) => ({
                            paddingVertical: 13,
                            paddingHorizontal: 16,
                            borderRadius: 8,
                            backgroundColor: p.dangerBg,
                            borderWidth: 1,
                            borderColor: p.dangerBg,
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: actionBusy ? 0.4 : pressed ? 0.7 : 1,
                          })}
                        >
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.dangerText, fontWeight: '700' }}>
                            <AppIcon name="close-outline" size={14} /> Hủy đơn
                          </Text>
                        </Pressable>

                        {/* Nút đóng cửa sổ chi tiết: nằm bên phải, lớn hơn */}
                        <View style={{ flex: 1 }}>
                          <Button title="Đóng cửa sổ chi tiết" secondary onPress={() => setDetailItem(null)} />
                        </View>
                      </View>
                    ) : (
                      <Button title="Đóng cửa sổ chi tiết" secondary onPress={() => setDetailItem(null)} />
                    )}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============================================================== */}
      {/* 11. APPROVAL MODAL (FOR MANAGERS)                              */}
      {/* ============================================================== */}
      <Modal visible={modalMode === 'approve'} transparent animationType="slide" onRequestClose={() => setModalMode(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(9,9,11,0.5)',
            justifyContent: 'flex-end',
            alignItems: 'stretch',
            padding: 0,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: undefined,
              backgroundColor: p.card,
              borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomWidth: 0,
              padding: 20,
              gap: 14,
              borderWidth: 1,
              borderColor: p.line,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label large>Xác nhận phê duyệt đơn</Label>
              <Pressable
                onPress={() => setModalMode(null)}
                hitSlop={10}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: p.bg,
                  borderWidth: 1,
                  borderColor: p.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="close-outline" style={{ fontSize: 14, color: p.muted, fontWeight: '700' }} />
              </Pressable>
            </View>

            {selectedRequest && (
              <View style={{ backgroundColor: p.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                  Phê duyệt đơn nghỉ <Text style={{ fontFamily: 'BeVietnamBold' }}>{selectedRequest.leave_type_name}</Text> của nhân viên{' '}
                  <Text style={{ fontFamily: 'BeVietnamBold', color: p.emeraldText }}>{selectedRequest.employee_name}</Text> (
                  {formatDateDMY(selectedRequest.start_date)} → {formatDateDMY(selectedRequest.end_date)}, {selectedRequest.total_days} ngày).
                </Text>
              </View>
            )}

            <Label>Ghi chú phê duyệt (không bắt buộc)</Label>
            <Input
              placeholder="Nhập ghi chú cho nhân sự..."
              value={actionNote}
              onChangeText={setActionNote}
              multiline
            />
            <Button
              title={actionBusy ? 'Đang duyệt…' : 'Xác nhận duyệt đơn'}
              onPress={() => void handleApproveRequest()}
              disabled={actionBusy}
            />
            <Button title="Đóng" secondary onPress={() => setModalMode(null)} disabled={actionBusy} />
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============================================================== */}
      {/* 12. REJECTION MODAL (FOR MANAGERS)                             */}
      {/* ============================================================== */}
      <Modal visible={modalMode === 'reject'} transparent animationType="slide" onRequestClose={() => setModalMode(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(9,9,11,0.5)',
            justifyContent: 'flex-end',
            alignItems: 'stretch',
            padding: 0,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: undefined,
              backgroundColor: p.card,
              borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomWidth: 0,
              padding: 20,
              gap: 14,
              borderWidth: 1,
              borderColor: p.line,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label large>Từ chối đơn xin nghỉ</Label>
              <Pressable
                onPress={() => setModalMode(null)}
                hitSlop={10}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: p.bg,
                  borderWidth: 1,
                  borderColor: p.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppIcon name="close-outline" style={{ fontSize: 14, color: p.muted, fontWeight: '700' }} />
              </Pressable>
            </View>

            {selectedRequest && (
              <View style={{ backgroundColor: p.dangerBg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.dangerBg }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.dangerText }}>
                  Từ chối đơn nghỉ của nhân viên{' '}
                  <Text style={{ fontFamily: 'BeVietnamBold', color: p.dangerText }}>{selectedRequest.employee_name}</Text> (
                  {selectedRequest.leave_type_name}, {formatDateDMY(selectedRequest.start_date)} → {formatDateDMY(selectedRequest.end_date)}).
                </Text>
              </View>
            )}

            <Label>Lý do từ chối (*) - Bắt buộc</Label>
            <Input
              placeholder="Nhập lý do từ chối (Vd: Chi nhánh thiếu người, trùng ca trực)..."
              value={rejectionReasonInput}
              onChangeText={setRejectionReasonInput}
              multiline
              numberOfLines={3}
            />
            <Button
              title={actionBusy ? 'Đang xử lý…' : 'Xác nhận từ chối'}
              onPress={() => void handleRejectRequest()}
              disabled={actionBusy || !rejectionReasonInput.trim()}
            />
            <Button title="Hủy bỏ" secondary onPress={() => setModalMode(null)} disabled={actionBusy} />
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

    </ScrollView>

      {/* BUTTON "ĐĂNG KÝ OT" NẰM Ở NGOÀI CARD BÊN DƯỚI GÓC PHẢI (CHO CẢ ĐƠN OT CỦA TÔI VÀ QUẢN LÝ DUYỆT OT) VỚI HIỆU ỨNG CHẠY TỪ PHẢI VÀO */}
      {domainTab === 'overtime' && (
        <Animated.View
          style={{
            position: 'absolute',
            bottom: 20,
            right: 18,
            zIndex: 9999,
            transform: [{ translateX: slideAnim }],
            opacity: opacityAnim,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Đăng ký làm thêm giờ OT mới"
            onPress={() => setShowCreateOtModal(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: p.brand,
              paddingVertical: 12,
              paddingHorizontal: 18,
              borderRadius: 8,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 8,
            }}
          >
            <AppIcon name="add-outline" style={{ fontSize: 20, color: p.onBrand }} />
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.onBrand }}>
              Đăng ký OT
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.body }}>
        {label} <Text style={{ fontFamily: 'MonoBold', fontSize: 12, color: p.text }}>{value}</Text>
      </Text>
    </View>
  );
}
