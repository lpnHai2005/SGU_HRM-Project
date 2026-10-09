import { AppText as Text } from '@/components/app-icon';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, useMemo } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { EyeIcon } from '@/components/eye-icon';
import { useSession } from '@/contexts/session';
import { ApiError, request } from '@/services/attendance';
import type { Profile } from '@/services/staff';
import { storeLabel } from '@/services/presentation';
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
  const [notifications, setNotifications] = useState<LeaveStatusNotification[]>([]);
  const [activeBanner, setActiveBanner] = useState<LeaveStatusNotification | null>(null);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
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
          setNotifications(prev => [...newNotifs, ...prev]);
          setActiveBanner(newNotifs[0]);
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
  }, [token, profile, selectedTypeId, isManager, signOut]);

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
      setNotice(`✓ ${res.message || 'Nộp đơn nghỉ phép thành công! Đơn đã vào quy trình chờ duyệt.'}`);
      setReason('');
      setAttachmentUrl('');
      const todayStr = formatDateToDMY(new Date());
      setStartDate(todayStr);
      setEndDate(todayStr);
      setTotalDays('1');

      const newNotif: LeaveStatusNotification = {
        id: `submit-${res.request_id}-${Date.now()}`,
        requestId: res.request_id,
        leaveTypeName: selectedTypeInfo?.type_name || 'Nghỉ phép',
        startDate: isoStart,
        endDate: isoEnd,
        newStatus: 'PENDING',
        message: `Đơn nghỉ phép #${res.request_id} đã được gửi thành công (Trạng thái: Chờ duyệt).`,
        timestamp: Date.now(),
        read: false,
      };
      setNotifications(prev => [newNotif, ...prev]);
      setActiveBanner(newNotif);

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
              setNotice(`✓ ${res.message || 'Đã hủy đơn xin nghỉ phép thành công.'}`);
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
      setNotice(`✓ ${res.message || 'Phê duyệt đơn nghỉ phép thành công!'}`);
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
      setNotice(`✓ ${res.message || 'Đã từ chối đơn nghỉ phép.'}`);
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

    return (
      <View
        style={{
          backgroundColor: p.bg,
          borderRadius: 8,
          padding: 8,
          gap: 6,
          borderWidth: 1,
          borderColor: p.line,
          marginTop: 4,
        }}
      >
        {/* Cấp 1: Cửa hàng trưởng (CHT) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: isStoreApproved ? '#16a34a' : isChtRejected ? '#dc2626' : item.status === 'PENDING' ? '#d97706' : p.muted }}>
              {isStoreApproved ? '✓ CHT' : isChtRejected ? '✕ CHT' : '⏳ CHT'}:
            </Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text, flex: 1 }} numberOfLines={1}>
              {item.store_approved_at
                ? (item.store_manager_name || 'Cửa hàng trưởng')
                : isChtRejected
                ? `${item.rejected_by_name || 'CHT'} (Từ chối)`
                : item.status === 'PENDING'
                ? 'Đang chờ CHT duyệt Cấp 1'
                : 'Không qua CHT'}
            </Text>
          </View>
          {item.store_approved_at ? (
            <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>
              {formatDateTimeDMY(item.store_approved_at)}
            </Text>
          ) : isChtRejected && item.rejected_at ? (
            <Text style={{ fontSize: 11, color: '#dc2626', fontFamily: 'BeVietnam' }}>
              {formatDateTimeDMY(item.rejected_at)}
            </Text>
          ) : null}
        </View>

        {/* Cấp 2: Phòng Nhân sự (HR) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: isHrApproved ? '#16a34a' : isHrRejected ? '#dc2626' : item.status === 'STORE_APPROVED' ? '#2563eb' : p.muted }}>
              {isHrApproved ? '✓ HR' : isHrRejected ? '✕ HR' : '⏳ HR'}:
            </Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text, flex: 1 }} numberOfLines={1}>
              {item.hr_approved_at
                ? (item.hr_approver_name || 'Phòng Nhân sự')
                : isHrRejected
                ? `${item.rejected_by_name || 'Phòng Nhân sự'} (Từ chối)`
                : item.status === 'STORE_APPROVED'
                ? 'Đang chờ HR phê duyệt Cấp 2'
                : item.status === 'PENDING'
                ? 'Chờ hoàn tất Cấp 1'
                : '—'}
            </Text>
          </View>
          {item.hr_approved_at ? (
            <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>
              {formatDateTimeDMY(item.hr_approved_at)}
            </Text>
          ) : isHrRejected && item.rejected_at ? (
            <Text style={{ fontSize: 11, color: '#dc2626', fontFamily: 'BeVietnam' }}>
              {formatDateTimeDMY(item.rejected_at)}
            </Text>
          ) : null}
        </View>

        {/* Rejection reason snippet if rejected */}
        {isRejected && !!item.rejection_reason && (
          <Text style={{ fontSize: 11, color: '#dc2626', fontFamily: 'BeVietnam', fontStyle: 'italic' }} numberOfLines={2}>
            Lý do: {item.rejection_reason}
          </Text>
        )}

        {/* Cancelled note */}
        {isCancelled && (
          <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam', fontStyle: 'italic' }}>
            Đơn đã bị hủy bởi người nộp.
          </Text>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* HEADER WITH NOTIFICATION BELL */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Label large>Quản lý Nghỉ phép</Label>
          <Label muted>{profile?.full_name || 'Nhân viên TechZone'} · {storeLabel(profile?.department_name || profile?.store_name)}</Label>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Xem thông báo trạng thái đơn"
          onPress={() => setShowNotificationCenter(true)}
          style={{
            padding: 10,
            borderRadius: 12,
            backgroundColor: p.card,
            borderWidth: 1,
            borderColor: p.line,
            position: 'relative',
          }}
        >
          <Text style={{ fontSize: 20 }}>🔔</Text>
          {notifications.filter(n => !n.read).length > 0 && (
            <View
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                backgroundColor: '#dc2626',
                borderRadius: 8,
                width: 16,
                height: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                {notifications.filter(n => !n.read).length}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* PUSH NOTIFICATION IN-APP BANNER */}
      {!!activeBanner && (
        <View
          style={{
            backgroundColor: activeBanner.newStatus === 'HR_APPROVED' ? '#dcfce7' : activeBanner.newStatus === 'REJECTED' ? '#fee2e2' : '#fef3c7',
            borderColor: activeBanner.newStatus === 'HR_APPROVED' ? '#86efac' : activeBanner.newStatus === 'REJECTED' ? '#fca5a5' : '#fde047',
            borderWidth: 1,
            borderRadius: 12,
            padding: 14,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: activeBanner.newStatus === 'HR_APPROVED' ? '#166534' : activeBanner.newStatus === 'REJECTED' ? '#991b1b' : '#854d0e' }}>
              {activeBanner.newStatus === 'HR_APPROVED' ? '🎉 THÔNG BÁO DUYỆT ĐƠN' : activeBanner.newStatus === 'REJECTED' ? '⚠️ THÔNG BÁO TỪ CHỐI' : '🔔 CẬP NHẬT TRẠNG THÁI'}
            </Text>
            <Pressable onPress={() => setActiveBanner(null)} hitSlop={10}>
              <Text style={{ color: '#6b7280', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </View>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: activeBanner.newStatus === 'HR_APPROVED' ? '#14532d' : activeBanner.newStatus === 'REJECTED' ? '#7f1d1d' : '#713f12' }}>
            {activeBanner.message}
          </Text>
        </View>
      )}

      {/* MANAGER TAB SWITCHER (IF USER IS MANAGER) */}
      {isManager && (
        <View style={{ flexDirection: 'row', backgroundColor: p.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: p.line }}>
          <Pressable
            accessibilityRole="tab"
            onPress={() => setActiveTab('my_leaves')}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              borderRadius: 8,
              backgroundColor: activeTab === 'my_leaves' ? p.accent : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: 'BeVietnamBold',
                fontSize: 13,
                color: activeTab === 'my_leaves' ? (p.dark ? '#09090b' : '#fff') : p.text,
              }}
            >
              Đơn của tôi
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            onPress={() => setActiveTab('manager_approvals')}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              borderRadius: 8,
              backgroundColor: activeTab === 'manager_approvals' ? p.accent : 'transparent',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                fontFamily: 'BeVietnamBold',
                fontSize: 13,
                color: activeTab === 'manager_approvals' ? (p.dark ? '#09090b' : '#fff') : p.text,
              }}
            >
              Quản lý duyệt đơn
            </Text>
            {pendingApprovalCount > 0 && (
              <View
                style={{
                  backgroundColor: '#dc2626',
                  borderRadius: 10,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{pendingApprovalCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      )}

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
          {/* 1. LEAVE BALANCE DISPLAY CARDS */}
          <Label large>Số dư phép năm & Quỹ nghỉ</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {/* CARD 1: CÒN LẠI (HIGHLIGHTED) */}
            <View style={{ flexBasis: '48%', flexGrow: 1 }}>
              <Card>
                <Label muted>Phép năm còn lại</Label>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 26, color: '#16a34a' }}>
                  {balance ? Number(balance.annual_leave_remaining).toFixed(1) : '—'}{' '}
                  <Text style={{ fontSize: 14, fontWeight: '400', color: p.muted }}>ngày</Text>
                </Text>
                <Label muted>Khả dụng đăng ký</Label>
              </Card>
            </View>

            {/* CARD 2: TỔNG TIÊU CHUẨN */}
            <View style={{ flexBasis: '48%', flexGrow: 1 }}>
              <Card>
                <Label muted>Tiêu chuẩn năm</Label>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 26, color: p.text }}>
                  {balance ? Number(balance.annual_leave_total).toFixed(1) : '12.0'}{' '}
                  <Text style={{ fontSize: 14, fontWeight: '400', color: p.muted }}>ngày</Text>
                </Text>
                <Label muted>
                  {balance && balance.seniority_bonus_days > 0
                    ? `+${balance.seniority_bonus_days} ngày thâm niên`
                    : '12 ngày cơ bản BLLĐ'}
                </Label>
              </Card>
            </View>

            {/* CARD 3: ĐÃ SỬ DỤNG */}
            <View style={{ flexBasis: '48%', flexGrow: 1 }}>
              <Card>
                <Label muted>Đã nghỉ (Duyệt)</Label>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 24, color: p.text }}>
                  {balance ? Number(balance.annual_leave_used).toFixed(1) : '0.0'}{' '}
                  <Text style={{ fontSize: 14, fontWeight: '400', color: p.muted }}>ngày</Text>
                </Text>
                <Label muted>Đã trừ vào số dư</Label>
              </Card>
            </View>

            {/* CARD 4: ĐANG CHỜ DUYỆT */}
            <View style={{ flexBasis: '48%', flexGrow: 1 }}>
              <Card>
                <Label muted>Đang chờ duyệt</Label>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 24, color: '#d97706' }}>
                  {balance ? Number(balance.pending_leave_days).toFixed(1) : '0.0'}{' '}
                  <Text style={{ fontSize: 14, fontWeight: '400', color: p.muted }}>ngày</Text>
                </Text>
                <Label muted>Đơn PENDING/STORE</Label>
              </Card>
            </View>
          </View>

          {/* SECONDARY LEAVE QUOTA INFO */}
          {balance && (balance.sick_leave_used > 0 || balance.unpaid_leave_used > 0 || balance.maternity_leave_used > 0) && (
            <Card>
              <Label muted>THỐNG KÊ NGHỈ CHẾ ĐỘ KHÁC NĂM {new Date().getFullYear()}</Label>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                • Nghỉ ốm BHXH: <Text style={{ color: p.text, fontWeight: '700' }}>{balance.sick_leave_used} ngày</Text> | 
                • Nghỉ không lương: <Text style={{ color: p.text, fontWeight: '700' }}>{balance.unpaid_leave_used} ngày</Text>
                {balance.maternity_leave_used > 0 && ` | • Thai sản: ${balance.maternity_leave_used} ngày`}
              </Text>
            </Card>
          )}

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
                borderRadius: 12,
                borderWidth: 1,
                borderColor: p.line,
                paddingHorizontal: 12,
              }}
            >
              <Text style={{ fontSize: 14, marginRight: 8 }}>🔍</Text>
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
                  <Text style={{ fontSize: 13, color: p.muted, fontWeight: '700' }}>✕</Text>
                </Pressable>
              )}
            </View>

            {/* Horizontal Month Scroll Pills */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {monthOptions.map(opt => {
                const isSelected = selectedMonth === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setSelectedMonth(opt.value)}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 13,
                      borderRadius: 16,
                      backgroundColor: isSelected ? p.accent : p.card,
                      borderWidth: 1,
                      borderColor: isSelected ? p.accent : p.line,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                        fontSize: 12,
                        color: isSelected ? (p.dark ? '#09090b' : '#fff') : p.text,
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
                    borderRadius: 16,
                    backgroundColor: selected ? p.accent : p.card,
                    borderWidth: 1,
                    borderColor: selected ? p.accent : p.line,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: selected ? 'BeVietnamBold' : 'BeVietnam',
                      fontSize: 12,
                      color: selected ? (p.dark ? '#09090b' : '#fff') : p.text,
                    }}
                  >
                    {labelText}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* REFINED COMPACT LEAVE REQUEST CARDS WITH STEP APPROVER & MINIMAL EYE BUTTON */}
          {filteredMyLeaves.map(item => {
            const meta = leaveStatusMeta[item.status] || {
              label: item.status,
              color: p.text,
              bg: p.card,
              step: 'Đang xử lý',
            };
            const canCancel = item.status === 'PENDING' || item.status === 'STORE_APPROVED';

            return (
              <Card key={item.request_id}>
                {/* Header Row: Title & Status Badge */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <Text
                    style={{
                      fontFamily: 'BeVietnamBold',
                      fontSize: 15,
                      color: p.text,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {item.leave_type_name}
                  </Text>
                  <View
                    style={{
                      backgroundColor: meta.bg,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 10,
                      flexShrink: 0,
                    }}
                  >
                    <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>
                      {meta.label}
                    </Text>
                  </View>
                </View>

                {/* Date range in dd-mm-yyyy and total days */}
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                  📅 {formatDateDMY(item.start_date)} → {formatDateDMY(item.end_date)} ·{' '}
                  <Text style={{ color: p.text, fontWeight: '700' }}>{item.total_days} ngày</Text>
                </Text>

                {/* Approval Stage Box: Cấp 1, Cấp 2, Approver & Timestamp */}
                {renderApprovalProgressBox(item)}

                {/* Bottom Row: Minimal Eye Button and Actions */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  {/* Minimal Eye Icon Button (matches web design, not default emoji) */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Xem chi tiết đơn #${item.request_id}`}
                    onPress={() => setDetailItem(item)}
                    style={({ pressed }) => ({
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      backgroundColor: p.bg,
                      borderWidth: 1,
                      borderColor: p.line,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <EyeIcon size={15} color={p.muted} />
                  </Pressable>

                  {/* Cancel Button if eligible */}
                  {canCancel && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => handleCancelLeave(item)}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: 8,
                        backgroundColor: '#fee2e2',
                        borderWidth: 1,
                        borderColor: '#fca5a5',
                      }}
                    >
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#dc2626' }}>
                        ✕ Hủy đơn
                      </Text>
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
                borderRadius: 12,
                borderWidth: 1,
                borderColor: p.line,
                paddingHorizontal: 12,
              }}
            >
              <Text style={{ fontSize: 14, marginRight: 8 }}>🔍</Text>
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
                  <Text style={{ fontSize: 13, color: p.muted, fontWeight: '700' }}>✕</Text>
                </Pressable>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {monthOptions.map(opt => {
                const isSelected = selectedMonth === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setSelectedMonth(opt.value)}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 13,
                      borderRadius: 16,
                      backgroundColor: isSelected ? p.accent : p.card,
                      borderWidth: 1,
                      borderColor: isSelected ? p.accent : p.line,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                        fontSize: 12,
                        color: isSelected ? (p.dark ? '#09090b' : '#fff') : p.text,
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
                    borderRadius: 16,
                    backgroundColor: selected ? p.accent : p.card,
                    borderWidth: 1,
                    borderColor: selected ? p.accent : p.line,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: selected ? 'BeVietnamBold' : 'BeVietnam',
                      fontSize: 12,
                      color: selected ? (p.dark ? '#09090b' : '#fff') : p.text,
                    }}
                  >
                    {labelText}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Compact Manager Request List with Eye Icon */}
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

            return (
              <Card key={item.request_id}>
                {/* Employee Info & Status Badge */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, color: p.text }} numberOfLines={1}>
                      {item.employee_name || 'Nhân viên'}
                    </Text>
                    <Label muted>
                      {item.employee_code || `#${item.employee_id}`} · {storeLabel(item.store_name || item.department_name)}
                    </Label>
                  </View>
                  <View style={{ backgroundColor: meta.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, flexShrink: 0 }}>
                    <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>
                      {meta.label}
                    </Text>
                  </View>
                </View>

                {/* Leave details & dd-mm-yyyy dates */}
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                  {item.leave_type_name} · 📅 {formatDateDMY(item.start_date)} → {formatDateDMY(item.end_date)} ({item.total_days} ngày)
                </Text>

                {/* Approval Stage Box: Cấp 1, Cấp 2, Approver & Timestamp */}
                {renderApprovalProgressBox(item)}

                {/* Manager Compact Actions Row with Minimal Eye Button */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  {/* Minimal Eye Icon Button (matches web design, not default emoji) */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Xem chi tiết đơn"
                    onPress={() => setDetailItem(item)}
                    style={({ pressed }) => ({
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      backgroundColor: p.bg,
                      borderWidth: 1,
                      borderColor: p.line,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <EyeIcon size={15} color={p.muted} />
                  </Pressable>

                  {/* Quick Manager Actions */}
                  {canApprove && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setSelectedRequest(item);
                          setActionNote(
                            isStoreManager
                              ? 'Cửa hàng trưởng đã kiểm tra ca kíp và duyệt Cấp 1.'
                              : 'Phòng Nhân sự đã phê duyệt chính thức.'
                          );
                          setModalMode('approve');
                        }}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                          borderRadius: 8,
                          backgroundColor: '#dcfce7',
                          borderWidth: 1,
                          borderColor: '#86efac',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#16a34a' }}>✓ Duyệt</Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setSelectedRequest(item);
                          setRejectionReasonInput('');
                          setModalMode('reject');
                        }}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                          borderRadius: 8,
                          backgroundColor: '#fee2e2',
                          borderWidth: 1,
                          borderColor: '#fca5a5',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#dc2626' }}>✕ Từ chối</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
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
      {/* 9. POPUP OVERLAY TẠO ĐƠN NGHỈ PHÉP MỚI (CREATE LEAVE MODAL)   */}
      {/* ============================================================== */}
      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 540,
              backgroundColor: p.card,
              borderRadius: 20,
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
                <Text style={{ fontSize: 16, color: p.muted, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
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
                        borderRadius: 20,
                        backgroundColor: isSelected ? p.accent : p.bg,
                        borderWidth: 1,
                        borderColor: isSelected ? p.accent : p.line,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam',
                          fontSize: 13,
                          color: isSelected ? (p.dark ? '#09090b' : '#fff') : p.text,
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
                    backgroundColor: selectedTypeInfo.is_paid ? '#f0fdf4' : '#fffbeb',
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: selectedTypeInfo.is_paid ? '#bbf7d0' : '#fef3c7',
                    gap: 4,
                  }}
                >
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: selectedTypeInfo.is_paid ? '#166534' : '#92400e' }}>
                    {selectedTypeInfo.is_paid ? '✓ Chế độ hưởng nguyên lương' : '⚠️ Nghỉ không hưởng lương (trừ vào lương tháng)'}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: selectedTypeInfo.is_paid ? '#14532d' : '#78350f' }}>
                    {selectedTypeInfo.type_code === 'PHEP_NAM'
                      ? `Số dư phép năm khả dụng: ${balance ? Number(balance.annual_leave_remaining).toFixed(1) : 12} ngày.`
                      : selectedTypeInfo.max_days_allowed && selectedTypeInfo.max_days_allowed > 0
                      ? `Hạn mức tối đa theo quy định: ${selectedTypeInfo.max_days_allowed} ngày/lần.`
                      : 'Không giới hạn ngày theo khung chuẩn.'}
                  </Text>
                  {selectedTypeInfo.requires_attachment && (
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#b91c1c' }}>
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
                    borderRadius: 10,
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
                    borderRadius: 10,
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
                    borderRadius: 10,
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
                  borderRadius: 14,
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
                    <Text style={{ fontSize: 16, color: p.text, fontWeight: '700' }}>‹</Text>
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
                    <Text style={{ fontSize: 16, color: p.text, fontWeight: '700' }}>›</Text>
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
                      backgroundColor: calTarget === 'start' ? (p.dark ? '#1e293b' : '#eff6ff') : p.card,
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
                      backgroundColor: calTarget === 'end' ? (p.dark ? '#1e293b' : '#eff6ff') : p.card,
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
                          color: idx >= 5 ? '#f97316' : p.muted,
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
                            ? (p.dark ? 'rgba(59, 130, 246, 0.22)' : '#e0e7ff')
                            : isSelected && !isSingle
                            ? (p.dark ? 'rgba(59, 130, 246, 0.22)' : '#e0e7ff')
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
                                ? '#ffffff'
                                : isInRange
                                ? (p.dark ? '#93c5fd' : '#1d4ed8')
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
                  ⚠️ {formValidationMsg}
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
      </Modal>

      {/* ============================================================== */}
      {/* 10. MODAL XEM CHI TIẾT ĐƠN (REFINED LAYOUT & ALIGNMENT)        */}
      {/* ============================================================== */}
      <Modal visible={!!detailItem} transparent animationType="fade" onRequestClose={() => setDetailItem(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 540,
              backgroundColor: p.card,
              borderRadius: 20,
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
                <Text style={{ fontSize: 16, color: p.muted, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
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
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: meta.color + '40',
                        }}
                      >
                        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 16, color: meta.color }}>
                          {meta.label}
                        </Text>
                        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: meta.color, marginTop: 4, lineHeight: 18 }}>
                          {detailItem.status === 'HR_APPROVED'
                            ? '✓ Đã hoàn tất phê duyệt chính thức bởi Phòng Nhân sự.'
                            : detailItem.status === 'STORE_APPROVED'
                            ? '✓ Cửa hàng trưởng đã duyệt Cấp 1 · Đang chờ Trưởng phòng Nhân sự duyệt Cấp 2.'
                            : detailItem.status === 'PENDING'
                            ? '⏳ Đang chờ Cửa hàng trưởng kiểm tra lịch ca trực và duyệt Cấp 1.'
                            : detailItem.status === 'REJECTED'
                            ? '✕ Đơn đã bị từ chối phê duyệt.'
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
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>Loại đơn nghỉ</Text>
                        <Text style={{ fontSize: 14, fontFamily: 'BeVietnamBold', color: p.text, marginTop: 3 }}>
                          {detailItem.leave_type_name}
                        </Text>
                        <Text style={{ fontSize: 11, color: p.muted, marginTop: 2 }}>Mã đơn: #{detailItem.request_id}</Text>
                      </View>
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>Tổng thời gian</Text>
                        <Text style={{ fontSize: 14, fontFamily: 'BeVietnamBold', color: p.accent, marginTop: 3 }}>
                          {detailItem.total_days} ngày
                        </Text>
                        <Text style={{ fontSize: 11, color: '#16a34a', fontFamily: 'BeVietnamBold', marginTop: 2 }}>
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
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>Họ và tên</Text>
                        <Text style={{ fontSize: 14, fontFamily: 'BeVietnamBold', color: p.text, marginTop: 3 }}>
                          {detailItem.employee_name}
                        </Text>
                        <Text style={{ fontSize: 11, color: p.muted, marginTop: 2 }}>
                          {detailItem.employee_code || `NV-#${detailItem.employee_id}`}
                        </Text>
                      </View>
                      <View style={{ flex: 1, backgroundColor: p.bg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: p.line }}>
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
                    <View style={{ backgroundColor: p.bg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: p.line }}>
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
                      <View style={{ backgroundColor: p.bg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: p.line }}>
                        <Text style={{ fontSize: 13, color: '#2563eb', fontFamily: 'BeVietnamBold' }}>
                          🔗 {detailItem.attachment_url}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* TIẾN TRÌNH PHÊ DUYỆT 2 CẤP */}
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: 'BeVietnamBold', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Tiến trình phê duyệt 2 Cấp
                    </Text>
                    <View style={{ backgroundColor: p.bg, borderRadius: 12, borderWidth: 1, borderColor: p.line, padding: 14, gap: 12 }}>
                      {/* Step 1: CHT */}
                      <View style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text, flex: 1, minWidth: 130 }}>
                            Cấp 1: Cửa hàng trưởng
                          </Text>
                          <View
                            style={{
                              backgroundColor: detailItem.store_approved_at ? '#dcfce7' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role === 'Cửa hàng trưởng' ? '#fee2e2' : '#fef3c7',
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
                                color: detailItem.store_approved_at ? '#16a34a' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role === 'Cửa hàng trưởng' ? '#991b1b' : '#854d0e',
                              }}
                            >
                              {detailItem.store_approved_at ? '✓ Đã duyệt' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role === 'Cửa hàng trưởng' ? '✕ Từ chối' : '⏳ Chờ duyệt'}
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
                              backgroundColor: detailItem.hr_approved_at ? '#dcfce7' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role !== 'Cửa hàng trưởng' ? '#fee2e2' : '#fef3c7',
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
                                color: detailItem.hr_approved_at ? '#16a34a' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role !== 'Cửa hàng trưởng' ? '#991b1b' : '#854d0e',
                              }}
                            >
                              {detailItem.hr_approved_at ? '✓ Đã duyệt' : detailItem.status === 'REJECTED' && detailItem.rejected_by_role !== 'Cửa hàng trưởng' ? '✕ Từ chối' : '⏳ Chờ duyệt'}
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
                    <View style={{ backgroundColor: '#fee2e2', padding: 14, borderRadius: 12, gap: 6, borderWidth: 1, borderColor: '#fca5a5' }}>
                      <Text style={{ color: '#991b1b', fontFamily: 'BeVietnamBold', fontSize: 13 }}>
                        ⚠️ LÝ DO TỪ CHỐI ĐƠN
                      </Text>
                      <Text style={{ color: '#7f1d1d', fontFamily: 'BeVietnam', fontSize: 13, lineHeight: 18 }}>
                        {detailItem.rejection_reason}
                      </Text>
                      <Text style={{ color: '#991b1b', fontSize: 12 }}>
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
                            title="✓ Duyệt đơn"
                            onPress={() => {
                              setSelectedRequest(detailItem);
                              setActionNote(isStoreManager ? 'Cửa hàng trưởng duyệt Cấp 1.' : 'Phòng Nhân sự phê duyệt.');
                              setModalMode('approve');
                            }}
                            disabled={actionBusy}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            title="✕ Từ chối"
                            secondary
                            onPress={() => {
                              setSelectedRequest(detailItem);
                              setRejectionReasonInput('');
                              setModalMode('reject');
                            }}
                            disabled={actionBusy}
                          />
                        </View>
                      </View>
                    )}

                    {(detailItem.status === 'PENDING' || detailItem.status === 'STORE_APPROVED') && detailItem.employee_id === profile?.employee_id ? (
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
                            borderRadius: 12,
                            backgroundColor: '#fee2e2',
                            borderWidth: 1,
                            borderColor: '#fca5a5',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: actionBusy ? 0.4 : pressed ? 0.7 : 1,
                          })}
                        >
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: '#dc2626', fontWeight: '700' }}>
                            ✕ Hủy đơn
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
      </Modal>

      {/* ============================================================== */}
      {/* 11. APPROVAL MODAL (FOR MANAGERS)                              */}
      {/* ============================================================== */}
      <Modal visible={modalMode === 'approve'} transparent animationType="fade" onRequestClose={() => setModalMode(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 480,
              backgroundColor: p.card,
              borderRadius: 20,
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
                <Text style={{ fontSize: 14, color: p.muted, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            {selectedRequest && (
              <View style={{ backgroundColor: p.bg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: p.line }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                  Phê duyệt đơn nghỉ <Text style={{ fontFamily: 'BeVietnamBold' }}>{selectedRequest.leave_type_name}</Text> của nhân viên{' '}
                  <Text style={{ fontFamily: 'BeVietnamBold', color: '#16a34a' }}>{selectedRequest.employee_name}</Text> (
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
      </Modal>

      {/* ============================================================== */}
      {/* 12. REJECTION MODAL (FOR MANAGERS)                             */}
      {/* ============================================================== */}
      <Modal visible={modalMode === 'reject'} transparent animationType="fade" onRequestClose={() => setModalMode(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 480,
              backgroundColor: p.card,
              borderRadius: 20,
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
                <Text style={{ fontSize: 14, color: p.muted, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            {selectedRequest && (
              <View style={{ backgroundColor: '#fee2e2', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5' }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: '#7f1d1d' }}>
                  Từ chối đơn nghỉ của nhân viên{' '}
                  <Text style={{ fontFamily: 'BeVietnamBold', color: '#991b1b' }}>{selectedRequest.employee_name}</Text> (
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
      </Modal>

      {/* ============================================================== */}
      {/* 13. NOTIFICATION CENTER MODAL                                 */}
      {/* ============================================================== */}
      <Modal visible={showNotificationCenter} transparent animationType="fade" onRequestClose={() => setShowNotificationCenter(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 500,
              backgroundColor: p.card,
              borderRadius: 20,
              maxHeight: '85%',
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
                <Label large>Thông báo trạng thái đơn</Label>
                <Label muted>Cập nhật ngay khi CHT hoặc HR phê duyệt/từ chối.</Label>
              </View>
              <Pressable
                onPress={() => setShowNotificationCenter(false)}
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
                <Text style={{ fontSize: 14, color: p.muted, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
              {notifications.map(notif => (
                <View
                  key={notif.id}
                  style={{
                    backgroundColor: p.bg,
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: p.line,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                      {notif.leaveTypeName}
                    </Text>
                    <Text style={{ fontSize: 11, color: p.muted }}>
                      {new Date(notif.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text }}>
                    {notif.message}
                  </Text>
                  <Text style={{ fontSize: 11, color: p.muted }}>
                    Kỳ nghỉ: {formatDateDMY(notif.startDate)} → {formatDateDMY(notif.endDate)}
                  </Text>
                </View>
              ))}

              {notifications.length === 0 && (
                <Card>
                  <Label>Chưa có thông báo mới. Các thay đổi trạng thái đơn sẽ xuất hiện tại đây.</Label>
                </Card>
              )}
            </ScrollView>

            <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: p.line }}>
              <Button title="Đóng thông báo" secondary onPress={() => setShowNotificationCenter(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
