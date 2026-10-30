import { AppIcon, AppText as Text } from '@/components/app-icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Button, Card, Input, Label, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { EyeIcon } from '@/components/eye-icon';
import type { Profile } from '@/services/staff';
import { storeLabel } from '@/services/presentation';
import {
  fetchMyOvertimeRequests,
  fetchManagerOvertimeRequests,
  createOvertimeRequest,
  employeeConfirmOvertime,
  employeeDeclineOvertime,
  approveOvertime,
  rejectOvertime,
  cancelOvertime,
  calculateOvertimeHours,
  fetchEmployeesForOvertime,
  overtimeStatusMeta,
  getOvertimeMultiplier,
  formatVerifiedHoursDisplay,
  reconciliationStatusMeta,
  type OvertimeRequestItem,
  type OvertimeRequestPayload,
  type SelectableEmployee,
} from '@/services/overtime';

// Helper định dạng ngày DD-MM-YYYY
function formatDateDMY(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr.trim())) return dateStr.trim();
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

// Helper định dạng giờ HH:mm
function formatTimeHHmm(dateTimeStr: string | null | undefined): string {
  if (!dateTimeStr) return '--:--';
  try {
    const d = new Date(dateTimeStr);
    if (!isNaN(d.getTime())) {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
  } catch {}
  if (dateTimeStr.includes('T')) {
    return dateTimeStr.slice(11, 16);
  }
  return dateTimeStr.slice(0, 5);
}

// Helper định dạng ngày giờ DD-MM-YYYY HH:mm
function formatDateTimeDMY(dateTimeStr: string | null | undefined): string {
  if (!dateTimeStr) return '—';
  try {
    const d = new Date(dateTimeStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${day}-${month}-${year} ${h}:${m}`;
    }
  } catch {}
  return formatDateDMY(dateTimeStr);
}

interface Props {
  token: string | null;
  profile: Profile | null;
  isManager: boolean;
  isStoreManager: boolean;
  isHrManager: boolean;
  isAdmin: boolean;
  monthOptions: { value: string; label: string }[];
  selectedMonth: string;
  setSelectedMonth: (val: string) => void;
  onRefreshLeaves?: () => void;
  showCreateModal?: boolean;
  setShowCreateModal?: (val: boolean) => void;
  activeScopeTab?: 'my_ot' | 'manager_ot';
  onScopeTabChange?: (tab: 'my_ot' | 'manager_ot') => void;
}

export function OvertimeManagement({
  token,
  profile,
  isManager,
  isStoreManager,
  isHrManager,
  isAdmin,
  monthOptions,
  selectedMonth,
  setSelectedMonth,
  showCreateModal: externalShowCreateModal,
  setShowCreateModal: setExternalShowCreateModal,
  activeScopeTab: externalScopeTab,
  onScopeTabChange,
}: Props) {
  const p = usePalette();

  // 1. Tab trong: 'my_ot' (Đơn của tôi) | 'manager_ot' (Quản lý duyệt)
  const [internalScopeTab, setInternalScopeTab] = useState<'my_ot' | 'manager_ot'>('my_ot');
  const activeScopeTab = externalScopeTab !== undefined ? externalScopeTab : internalScopeTab;
  const setActiveScopeTab = (tab: 'my_ot' | 'manager_ot') => {
    setInternalScopeTab(tab);
    if (onScopeTabChange) onScopeTabChange(tab);
  };

  // State chọn nhân viên tăng ca cho HR / Store Manager
  const [employees, setEmployees] = useState<SelectableEmployee[]>([]);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<SelectableEmployee | null>(null);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [employeeSearchText, setEmployeeSearchText] = useState('');

  // 2. Danh sách dữ liệu
  const [myOtList, setMyOtList] = useState<OvertimeRequestItem[]>([]);
  const [managerOtList, setManagerOtList] = useState<OvertimeRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // 3. Bộ lọc & Tìm kiếm
  const [myStatusFilter, setMyStatusFilter] = useState<string>('ALL');
  const [mgrStatusFilter, setMgrStatusFilter] = useState<string>('PENDING_ONLY');
  const [searchQuery, setSearchQuery] = useState('');

  // 4. Modal tạo đơn OT mới
  const [internalCreateModal, setInternalCreateModal] = useState(false);
  const showCreateModal =
    externalShowCreateModal !== undefined ? externalShowCreateModal : internalCreateModal;
  const setShowCreateModal = setExternalShowCreateModal || setInternalCreateModal;
  const [otWorkDate, setOtWorkDate] = useState(() => {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  });
  const [otStartTime, setOtStartTime] = useState('18:00');
  const [otEndTime, setOtEndTime] = useState('20:00');
  const [otReason, setOtReason] = useState('');
  const [otNotes, setOtNotes] = useState('');

  // 5. Modal Xem chi tiết đơn OT
  const [detailItem, setDetailItem] = useState<OvertimeRequestItem | null>(null);

  // 6. Modal Xác nhận Duyệt / Từ chối của Quản lý
  const [confirmApproveItem, setConfirmApproveItem] = useState<OvertimeRequestItem | null>(null);
  const [rejectItem, setRejectItem] = useState<OvertimeRequestItem | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');

  // Tải dữ liệu OT
  const loadOtData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const myItems = await fetchMyOvertimeRequests(token, profile?.employee_id);
      setMyOtList(myItems || []);

      if (isManager) {
        const mgrItems = await fetchManagerOvertimeRequests(token, profile?.store_id);
        setManagerOtList(mgrItems || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Không thể tải danh sách đơn tăng ca (OT).');
    } finally {
      setLoading(false);
    }
  }, [token, profile?.employee_id, profile?.store_id, isManager]);

  useEffect(() => {
    void loadOtData();
  }, [loadOtData]);

  // Tải danh sách nhân viên chi nhánh cho HR / Store Manager
  useEffect(() => {
    if (!token || !isManager) return;
    let isMounted = true;
    setEmployeeLoading(true);
    fetchEmployeesForOvertime(token, profile?.store_id)
      .then(list => {
        if (!isMounted) return;
        // Nếu là Store Manager, luật backend không cho phép tạo OT cho chính mình
        const eligible = isStoreManager && !isAdmin && !isHrManager
          ? list.filter(e => e.employee_id !== profile?.employee_id)
          : list;
        setEmployees(eligible);
        if (eligible.length > 0) {
          setSelectedEmployee(prev => prev || eligible[0]);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setEmployeeLoading(false);
      });
    return () => { isMounted = false; };
  }, [token, isManager, isStoreManager, isAdmin, isHrManager, profile?.store_id, profile?.employee_id]);

  // Danh sách nhân viên sau khi lọc theo từ khóa tìm kiếm trong dropdown
  const filteredEmployees = useMemo(() => {
    const q = employeeSearchText.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      e =>
        e.full_name?.toLowerCase().includes(q) ||
        e.employee_code?.toLowerCase().includes(q) ||
        String(e.employee_id).includes(q)
    );
  }, [employees, employeeSearchText]);

  // Số lượng đơn OT chờ duyệt của Quản lý
  const pendingOtApprovalCount = useMemo(() => {
    return managerOtList.filter(item => {
      if (item.employee_id === profile?.employee_id) return false;
      return item.status === 'PENDING_HR' || item.status === 'PENDING_EMPLOYEE_CONFIRMATION';
    }).length;
  }, [managerOtList, profile?.employee_id]);

  // Thống kê nhanh giờ OT của tôi trong tháng được chọn
  // CHỈ tính giờ của các đơn ĐÃ ĐƯỢC ĐỐI SOÁT (VERIFIED), không lấy giờ đăng ký dự kiến
  const myOtStats = useMemo(() => {
    let list = myOtList;
    if (selectedMonth !== 'ALL') {
      list = list.filter(r => r.work_date?.startsWith(selectedMonth));
    }
    const verifiedList = list.filter(
      r => r.reconciliation_status === 'VERIFIED' || (r.verified_hours != null && r.verified_hours > 0)
    );
    const totalVerifiedHours = verifiedList.reduce((sum, r) => {
      const hrs = r.verified_hours != null
        ? r.verified_hours
        : (r.verified_microseconds ? Number((r.verified_microseconds / 3600000000.0).toFixed(2)) : 0);
      return sum + hrs;
    }, 0);
    const pendingCount = list.filter(
      r => r.status === 'PENDING_HR' || r.status === 'PENDING_EMPLOYEE_CONFIRMATION'
    ).length;

    return {
      totalHours: totalVerifiedHours,
      totalRequests: list.length,
      pendingCount,
      verifiedCount: verifiedList.length,
    };
  }, [myOtList, selectedMonth]);

  // Lọc danh sách Đơn của tôi
  const filteredMyOtList = useMemo(() => {
    let list = myOtList;
    if (selectedMonth !== 'ALL') {
      list = list.filter(r => r.work_date?.startsWith(selectedMonth));
    }
    if (myStatusFilter === 'PENDING') {
      list = list.filter(
        r => r.status === 'PENDING_HR' || r.status === 'PENDING_EMPLOYEE_CONFIRMATION' || r.status === 'DRAFT'
      );
    } else if (myStatusFilter === 'APPROVED') {
      list = list.filter(r => r.status === 'APPROVED');
    } else if (myStatusFilter === 'REJECTED') {
      list = list.filter(
        r => r.status === 'REJECTED' || r.status === 'CANCELLED' || r.status === 'EMPLOYEE_DECLINED'
      );
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        return (
          String(r.request_id).includes(q) ||
          r.reason?.toLowerCase().includes(q) ||
          r.notes?.toLowerCase().includes(q) ||
          r.rejection_reason?.toLowerCase().includes(q) ||
          r.reviewer_name?.toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [myOtList, selectedMonth, myStatusFilter, searchQuery]);

  // Lọc danh sách Quản lý duyệt
  const filteredManagerOtList = useMemo(() => {
    let candidateList = managerOtList.filter(r => r.employee_id !== profile?.employee_id);
    if (selectedMonth !== 'ALL') {
      candidateList = candidateList.filter(r => r.work_date?.startsWith(selectedMonth));
    }

    if (mgrStatusFilter === 'PENDING_ONLY') {
      candidateList = candidateList.filter(
        r => r.status === 'PENDING_HR' || r.status === 'PENDING_EMPLOYEE_CONFIRMATION'
      );
    } else if (mgrStatusFilter === 'APPROVED') {
      candidateList = candidateList.filter(r => r.status === 'APPROVED');
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      candidateList = candidateList.filter(r => {
        return (
          String(r.request_id).includes(q) ||
          r.employee_name?.toLowerCase().includes(q) ||
          r.employee_code?.toLowerCase().includes(q) ||
          r.store_name?.toLowerCase().includes(q) ||
          r.department_name?.toLowerCase().includes(q) ||
          r.reason?.toLowerCase().includes(q) ||
          r.notes?.toLowerCase().includes(q) ||
          r.reviewer_name?.toLowerCase().includes(q)
        );
      });
    }

    return candidateList;
  }, [managerOtList, profile?.employee_id, selectedMonth, mgrStatusFilter, searchQuery]);

  // Hành động: Tạo đơn tăng ca
  const handleCreateOt = async () => {
    if (!token) return;
    const isManagerCreating = activeScopeTab === 'manager_ot' && isManager;
    const targetEmployeeId = isManagerCreating && selectedEmployee
      ? selectedEmployee.employee_id
      : (profile?.employee_id || selectedEmployee?.employee_id);
    const targetStoreId = isManagerCreating && selectedEmployee
      ? selectedEmployee.store_id
      : (profile?.store_id || selectedEmployee?.store_id);

    if (!targetEmployeeId) {
      Alert.alert('Thiếu nhân viên', 'Vui lòng chọn nhân viên thực hiện ca làm thêm giờ.');
      return;
    }
    if (!otWorkDate) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn ngày làm việc OT.');
      return;
    }
    if (!otStartTime || !otEndTime) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập giờ bắt đầu và kết thúc OT.');
      return;
    }
    if (otReason.trim().length < 3) {
      Alert.alert('Lý do không hợp lệ', 'Lý do đăng ký OT phải có ít nhất 3 ký tự.');
      return;
    }

    setActionBusy(true);
    setError('');
    try {
      const payload: OvertimeRequestPayload = {
        employee_id: targetEmployeeId,
        store_id: targetStoreId || undefined,
        work_date: otWorkDate,
        start_time: otStartTime.length === 5 ? `${otStartTime}:00` : otStartTime,
        end_time: otEndTime.length === 5 ? `${otEndTime}:00` : otEndTime,
        reason: otReason.trim(),
        notes: otNotes.trim() || undefined,
      };

      await createOvertimeRequest(token, payload);
      setNotice('Đã gửi đơn đăng ký tăng ca (OT) thành công!');
      setShowCreateModal(false);
      setOtReason('');
      setOtNotes('');
      await loadOtData();
    } catch (e: any) {
      setError(e?.message || 'Không thể tạo đơn tăng ca. Vui lòng kiểm tra lại.');
    } finally {
      setActionBusy(false);
    }
  };

  // Hành động: Quản lý Phê duyệt đơn OT
  const handleApproveOt = async (requestId: number) => {
    if (!token) return;
    setActionBusy(true);
    setError('');
    try {
      await approveOvertime(token, requestId);
      setNotice(`Đã phê duyệt đơn tăng ca #${requestId} thành công.`);
      setConfirmApproveItem(null);
      if (detailItem?.request_id === requestId) setDetailItem(null);
      await loadOtData();
    } catch (e: any) {
      setError(e?.message || 'Không thể phê duyệt đơn OT.');
    } finally {
      setActionBusy(false);
    }
  };

  // Hành động: Quản lý Từ chối đơn OT
  const handleRejectOt = async () => {
    if (!token || !rejectItem) return;
    if (rejectionReasonInput.trim().length < 3) {
      Alert.alert('Lý do bắt buộc', 'Vui lòng nhập lý do từ chối (tối thiểu 3 ký tự).');
      return;
    }

    setActionBusy(true);
    setError('');
    try {
      await rejectOvertime(token, rejectItem.request_id, rejectionReasonInput.trim());
      setNotice(`Đã từ chối đơn tăng ca #${rejectItem.request_id}.`);
      setRejectItem(null);
      setRejectionReasonInput('');
      if (detailItem?.request_id === rejectItem.request_id) setDetailItem(null);
      await loadOtData();
    } catch (e: any) {
      setError(e?.message || 'Không thể từ chối đơn OT.');
    } finally {
      setActionBusy(false);
    }
  };

  // Hành động: Nhân viên Hủy đơn OT
  const handleCancelOt = async (requestId: number) => {
    if (!token) return;
    Alert.alert(
      'Hủy đơn OT',
      'Bạn có chắc chắn muốn hủy đơn đăng ký tăng ca này?',
      [
        { text: 'Quay lại', style: 'cancel' },
        {
          text: 'Xác nhận hủy',
          style: 'destructive',
          onPress: async () => {
            setActionBusy(true);
            try {
              await cancelOvertime(token, requestId, 'Nhân viên chủ động hủy đơn');
              setNotice(`Đã hủy đơn tăng ca #${requestId}.`);
              if (detailItem?.request_id === requestId) setDetailItem(null);
              await loadOtData();
            } catch (e: any) {
              setError(e?.message || 'Không thể hủy đơn tăng ca.');
            } finally {
              setActionBusy(false);
            }
          },
        },
      ]
    );
  };

  // Hành động: Nhân viên Xác nhận đề xuất OT (Cấp 1)
  const handleEmployeeConfirm = async (requestId: number) => {
    if (!token) return;
    setActionBusy(true);
    try {
      await employeeConfirmOvertime(token, requestId);
      setNotice(`Đã xác nhận tham gia ca OT #${requestId}. Đơn đã chuyển sang chờ HR phê duyệt.`);
      if (detailItem?.request_id === requestId) setDetailItem(null);
      await loadOtData();
    } catch (e: any) {
      setError(e?.message || 'Không thể xác nhận đơn OT.');
    } finally {
      setActionBusy(false);
    }
  };

  // Hành động: Nhân viên Từ chối đề xuất OT (Cấp 1)
  const handleEmployeeDecline = async (requestId: number) => {
    if (!token) return;
    Alert.prompt
      ? Alert.prompt(
          'Từ chối đề xuất tăng ca',
          'Nhập lý do bạn không thể tham gia ca OT này:',
          async text => {
            setActionBusy(true);
            try {
              await employeeDeclineOvertime(token, requestId, text || 'Không sắp xếp được thời gian');
              setNotice(`Đã từ chối đề xuất OT #${requestId}.`);
              if (detailItem?.request_id === requestId) setDetailItem(null);
              await loadOtData();
            } catch (e: any) {
              setError(e?.message || 'Không thể từ chối đề xuất OT.');
            } finally {
              setActionBusy(false);
            }
          }
        )
      : Alert.alert(
          'Từ chối đề xuất',
          'Xác nhận từ chối tham gia ca tăng ca này?',
          [
            { text: 'Quay lại', style: 'cancel' },
            {
              text: 'Từ chối',
              style: 'destructive',
              onPress: async () => {
                setActionBusy(true);
                try {
                  await employeeDeclineOvertime(token, requestId, 'Không sắp xếp được thời gian');
                  setNotice(`Đã từ chối đề xuất OT #${requestId}.`);
                  if (detailItem?.request_id === requestId) setDetailItem(null);
                  await loadOtData();
                } catch (e: any) {
                  setError(e?.message || 'Không thể từ chối.');
                } finally {
                  setActionBusy(false);
                }
              },
            },
          ]
        );
  };

  // Tính toán số giờ OT dự kiến trong modal tạo
  const estimatedHours = useMemo(() => {
    if (!otWorkDate || !otStartTime || !otEndTime) return 0;
    try {
      const s = new Date(`${otWorkDate}T${otStartTime}:00`);
      const e = new Date(`${otWorkDate}T${otEndTime}:00`);
      if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return 0;
      return Number(((e.getTime() - s.getTime()) / (1000 * 3600)).toFixed(2));
    } catch {
      return 0;
    }
  }, [otWorkDate, otStartTime, otEndTime]);

  // Render Hộp Tiến trình duyệt 2 cấp (Cấp 1 - Cấp 2)
  const renderOtProgressBox = (item: OvertimeRequestItem) => {
    const isStep1Done =
      item.status === 'PENDING_HR' ||
      item.status === 'APPROVED' ||
      item.status === 'REJECTED' ||
      item.status === 'REVOKED' ||
      item.status === 'REPLACED';
    const isStep1Waiting = item.status === 'PENDING_EMPLOYEE_CONFIRMATION';
    const isStep1Declined = item.status === 'EMPLOYEE_DECLINED';

    const isStep2Done = item.status === 'APPROVED';
    const isStep2Waiting = item.status === 'PENDING_HR';
    const isStep2Rejected = item.status === 'REJECTED';
    const isCancelled = item.status === 'CANCELLED';

    return (
      <View
        style={{
          backgroundColor: p.bg,
          borderRadius: 10,
          padding: 10,
          gap: 6,
          borderWidth: 1,
          borderColor: p.line,
          marginTop: 6,
        }}
      >
        {/* Cấp 1: Nhân viên xác nhận / CHT đề xuất */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text
              style={{
                fontFamily: 'BeVietnamBold',
                fontSize: 11,
                color: isStep1Done ? '#16a34a' : isStep1Declined ? '#dc2626' : isStep1Waiting ? '#d97706' : p.muted,
              }}
            >
              {isStep1Done ? 'CẤP 1' : isStep1Declined ? 'CẤP 1' : '⏳ CẤP 1'}:
            </Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text, flex: 1 }} numberOfLines={1}>
              {isStep1Done
                ? 'Nhân viên đã xác nhận ca OT'
                : isStep1Declined
                ? 'Nhân viên đã từ chối'
                : isStep1Waiting
                ? 'Chờ nhân viên xác nhận đề xuất'
                : 'Bản nháp chưa gửi'}
            </Text>
          </View>
          {item.employee_confirmed_at ? (
            <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam' }}>
              {formatDateTimeDMY(item.employee_confirmed_at)}
            </Text>
          ) : null}
        </View>

        {/* Cấp 2: Quản lý / Phòng Nhân sự phê duyệt */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text
              style={{
                fontFamily: 'BeVietnamBold',
                fontSize: 11,
                color: isStep2Done ? '#16a34a' : isStep2Rejected ? '#dc2626' : isStep2Waiting ? '#2563eb' : p.muted,
              }}
            >
              {isStep2Done ? 'CẤP 2' : isStep2Rejected ? 'CẤP 2' : '⏳ CẤP 2'}:
            </Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text, flex: 1 }} numberOfLines={1}>
              {isStep2Done
                ? `HR đã duyệt ${item.reviewer_name ? `(${item.reviewer_name})` : ''}`
                : isStep2Rejected
                ? 'HR / Quản lý đã từ chối'
                : isStep2Waiting
                ? 'Đang chờ Quản lý / HR phê duyệt'
                : 'Chờ hoàn tất Cấp 1'}
            </Text>
          </View>
          {item.reviewed_at ? (
            <Text style={{ fontSize: 11, color: isStep2Done ? p.muted : '#dc2626', fontFamily: 'BeVietnam' }}>
              {formatDateTimeDMY(item.reviewed_at)}
            </Text>
          ) : null}
        </View>

        {/* Rejection Note */}
        {isStep2Rejected && !!item.rejection_reason && (
          <Text style={{ fontSize: 11, color: '#dc2626', fontFamily: 'BeVietnam', fontStyle: 'italic' }} numberOfLines={2}>
            Lý do từ chối: {item.rejection_reason}
          </Text>
        )}

        {/* Cancelled Note */}
        {isCancelled && (
          <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam', fontStyle: 'italic' }}>
            Đơn tăng ca đã được hủy.
          </Text>
        )}
      </View>
    );
  };

  return (
    <View style={{ gap: 12 }}>
      {/* 1. NAV TRONG: [ Đơn của tôi ] vs [ Quản lý duyệt ] */}
      {isManager && (
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: p.card,
            borderRadius: 12,
            padding: 4,
            borderWidth: 1,
            borderColor: p.line,
          }}
        >
          <Pressable
            accessibilityRole="tab"
            onPress={() => setActiveScopeTab('my_ot')}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              borderRadius: 8,
              backgroundColor: activeScopeTab === 'my_ot' ? p.accent : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: 'BeVietnamBold',
                fontSize: 13,
                color: activeScopeTab === 'my_ot' ? (p.dark ? '#09090b' : '#fff') : p.text,
              }}
            >
              Đơn OT của tôi
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            onPress={() => setActiveScopeTab('manager_ot')}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              borderRadius: 8,
              backgroundColor: activeScopeTab === 'manager_ot' ? p.accent : 'transparent',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                fontFamily: 'BeVietnamBold',
                fontSize: 13,
                color: activeScopeTab === 'manager_ot' ? (p.dark ? '#09090b' : '#fff') : p.text,
              }}
            >
              Quản lý duyệt OT
            </Text>
            {pendingOtApprovalCount > 0 && (
              <View
                style={{
                  backgroundColor: '#dc2626',
                  borderRadius: 10,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                  {pendingOtApprovalCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      )}

      {/* Loading & Messages */}
      <LoadingBar active={loading || actionBusy} label="Đang đồng bộ dữ liệu tăng ca (OT)…" />
      {!!error && (
        <Card>
          <Text style={{ color: p.danger, fontFamily: 'BeVietnam' }}>{error}</Text>
          <Button title="Tải lại dữ liệu" secondary onPress={() => void loadOtData()} />
        </Card>
      )}
      {!!notice && (
        <Card>
          <Label>{notice}</Label>
        </Card>
      )}

      {/* ============================================================== */}
      {/* SCOPE TAB 1: ĐƠN TĂNG CA CỦA TÔI                               */}
      {/* ============================================================== */}
      {activeScopeTab === 'my_ot' && (
        <>
          {/* Quick Metrics Summary */}
          <Label large>Thống kê giờ tăng ca ({selectedMonth === 'ALL' ? 'Tất cả' : selectedMonth})</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <View style={{ flexBasis: '48%', flexGrow: 1 }}>
              <Card>
                <Label muted>Giờ OT đã đối soát</Label>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 26, color: '#16a34a' }}>
                  {myOtStats.totalHours.toFixed(2)}{' '}
                  <Text style={{ fontSize: 14, fontWeight: '400', color: p.muted }}>giờ</Text>
                </Text>
                <Label muted>Hợp lệ được tính trả lương</Label>
              </Card>
            </View>

            <View style={{ flexBasis: '48%', flexGrow: 1 }}>
              <Card>
                <Label muted>Đang chờ duyệt</Label>
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 26, color: '#d97706' }}>
                  {myOtStats.pendingCount}{' '}
                  <Text style={{ fontSize: 14, fontWeight: '400', color: p.muted }}>đơn</Text>
                </Text>
                <Label muted>Tiến trình Cấp 1–Cấp 2</Label>
              </Card>
            </View>
          </View>

          {/* Header & Count */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <Label large>Lịch sử đơn tăng ca của bạn</Label>
            <Text style={{ fontSize: 12, color: p.muted, fontFamily: 'BeVietnam' }}>
              {filteredMyOtList.length} đơn
            </Text>
          </View>

          {/* Search Bar + Month Scroll Pills */}
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
              <AppIcon name="search-outline" style={{ fontSize: 16, marginRight: 8, color: p.muted }} />
              <TextInput
                accessibilityLabel="Tìm kiếm đơn tăng ca"
                placeholder="Tìm theo mã đơn, ngày, lý do OT..."
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
                  <AppIcon name="close-outline" style={{ fontSize: 15, color: p.muted }} />
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

          {/* Status Filter Pills */}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
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

          {/* Danh sách đơn OT của tôi */}
          {filteredMyOtList.length === 0 ? (
            <Card>
              <View style={{ paddingVertical: 24, alignItems: 'center', gap: 6 }}>
                <AppIcon name="time-outline" style={{ fontSize: 32, color: p.muted }} />
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>
                  Chưa có đơn tăng ca nào
                </Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, textAlign: 'center' }}>
                  Không tìm thấy đơn OT phù hợp với bộ lọc trong kỳ này.
                </Text>
              </View>
            </Card>
          ) : (
            filteredMyOtList.map(item => {
              const meta = overtimeStatusMeta[item.status] || {
                label: item.status,
                color: p.text,
                bg: p.card,
                step: 'Đang xử lý',
              };
              const durationHours = calculateOvertimeHours(item.starts_at, item.ends_at);
              const canCancel = item.status === 'PENDING_HR' || item.status === 'DRAFT';
              const needsConfirm = item.status === 'PENDING_EMPLOYEE_CONFIRMATION';

              return (
                <Card key={item.request_id}>
                  {/* Header: Mã đơn & Badge trạng thái */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, color: p.text }}>
                        Đơn OT #{item.request_id}
                      </Text>
                      <Label muted>{formatDateDMY(item.work_date)}</Label>
                    </View>
                    <View
                      style={{
                        backgroundColor: meta.bg,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    >
                      <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>
                        {meta.label}
                      </Text>
                    </View>
                  </View>

                  {/* Thông tin khung giờ & số giờ */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AppIcon name="time-outline" style={{ fontSize: 15, color: p.brand }} />
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                      {formatTimeHHmm(item.starts_at)} → {formatTimeHHmm(item.ends_at)}
                    </Text>
                    <View style={{ backgroundColor: p.bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: p.line }}>
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.brand }}>
                        {durationHours.toFixed(1)} giờ OT
                      </Text>
                    </View>
                  </View>

                  {/* Thông tin đối soát & Hệ số OT */}
                  {item.reconciliation_status === 'VERIFIED' ? (
                    (() => {
                      const mult = getOvertimeMultiplier(item);
                      const verifiedFmt = formatVerifiedHoursDisplay(item.verified_hours, item.verified_microseconds);
                      return (
                        <View
                          style={{
                            backgroundColor: 'rgba(22, 163, 74, 0.08)',
                            padding: 8,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: 'rgba(22, 163, 74, 0.25)',
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <AppIcon name="checkmark-circle" style={{ fontSize: 15, color: '#16a34a' }} />
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#16a34a' }}>
                              Đã đối soát: {verifiedFmt.minutesText} ({verifiedFmt.hoursText})
                            </Text>
                          </View>
                          <View
                            style={{
                              backgroundColor: mult.bg,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 6,
                              borderWidth: 1,
                              borderColor: mult.borderColor,
                            }}
                          >
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: mult.color }}>
                              Hệ số {mult.rate}
                            </Text>
                          </View>
                        </View>
                      );
                    })()
                  ) : item.status === 'APPROVED' ? (
                    (() => {
                      const mult = getOvertimeMultiplier(item);
                      return (
                        <View
                          style={{
                            backgroundColor: 'rgba(217, 119, 6, 0.08)',
                            padding: 8,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: 'rgba(217, 119, 6, 0.2)',
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <AppIcon name="hourglass-outline" style={{ fontSize: 14, color: '#d97706' }} />
                            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: '#d97706' }}>
                              Chờ HR đối soát giờ công
                            </Text>
                          </View>
                          <View
                            style={{
                              backgroundColor: mult.bg,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 6,
                            }}
                          >
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: mult.color }}>
                              Dự kiến {mult.rate}
                            </Text>
                          </View>
                        </View>
                      );
                    })()
                  ) : null}

                  {/* Lý do OT */}
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                    Lý do: <Text style={{ color: p.muted }}>{item.reason}</Text>
                  </Text>
                  {!!item.notes && (
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, fontStyle: 'italic' }}>
                      Ghi chú: {item.notes}
                    </Text>
                  )}

                  {/* Hộp Tiến trình duyệt Cấp 1–Cấp 2 */}
                  {renderOtProgressBox(item)}

                  {/* Thao tác của Nhân viên */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    {/* Nút Xem chi tiết */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Xem chi tiết đơn OT"
                      onPress={() => setDetailItem(item)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 8,
                        backgroundColor: p.bg,
                        borderWidth: 1,
                        borderColor: p.line,
                      }}
                    >
                      <EyeIcon size={14} color={p.muted} />
                      <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text }}>Chi tiết</Text>
                    </Pressable>

                    {/* Thao tác Xác nhận (nếu CHT tạo đề xuất cho NV) */}
                    {needsConfirm && (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable
                          onPress={() => void handleEmployeeDecline(item.request_id)}
                          style={{
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            borderWidth: 1.5,
                            borderColor: '#dc2626',
                            backgroundColor: 'transparent',
                          }}
                        >
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#dc2626' }}>
                            Từ chối
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void handleEmployeeConfirm(item.request_id)}
                          style={{
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            backgroundColor: '#16a34a',
                          }}
                        >
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#fff' }}>
                            Xác nhận OT
                          </Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Thao tác Hủy đơn */}
                    {canCancel && !needsConfirm && (
                      <Pressable
                        onPress={() => void handleCancelOt(item.request_id)}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 8,
                          backgroundColor: p.bg,
                          borderWidth: 1,
                          borderColor: p.line,
                        }}
                      >
                        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.danger }}>
                          Hủy đơn
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </Card>
              );
            })
          )}
        </>
      )}

      {/* ============================================================== */}
      {/* SCOPE TAB 2: QUẢN LÝ DUYỆT ĐƠN TĂNG CA (CHO MANAGER/HR/ADMIN)  */}
      {/* ============================================================== */}
      {activeScopeTab === 'manager_ot' && isManager && (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label large>Duyệt tăng ca chi nhánh / bộ phận</Label>
            <Text style={{ fontSize: 12, color: p.muted, fontFamily: 'BeVietnam' }}>
              {filteredManagerOtList.length} đơn
            </Text>
          </View>

          {/* Search Bar + Month Scroll Pills */}
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
              <AppIcon name="search-outline" style={{ fontSize: 16, marginRight: 8, color: p.muted }} />
              <TextInput
                accessibilityLabel="Tìm kiếm đơn OT cần duyệt"
                placeholder="Tìm theo nhân viên, mã NV, cửa hàng, lý do..."
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
                  <AppIcon name="close-outline" style={{ fontSize: 15, color: p.muted }} />
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

          {/* Filter Pills */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[
              ['PENDING_ONLY', `Cần duyệt (${pendingOtApprovalCount})`],
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

          {/* Danh sách Đơn OT Quản lý duyệt */}
          {filteredManagerOtList.length === 0 ? (
            <Card>
              <View style={{ paddingVertical: 24, alignItems: 'center', gap: 6 }}>
                <AppIcon name="checkmark-done-circle-outline" style={{ fontSize: 32, color: '#16a34a' }} />
                <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>
                  Không có đơn OT cần xử lý
                </Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, textAlign: 'center' }}>
                  Tất cả các đơn đăng ký tăng ca trong phạm vi đã được giải quyết hoặc chưa phát sinh.
                </Text>
              </View>
            </Card>
          ) : (
            filteredManagerOtList.map(item => {
              const meta = overtimeStatusMeta[item.status] || {
                label: item.status,
                color: p.text,
                bg: p.card,
                step: 'Đang xử lý',
              };
              const durationHours = calculateOvertimeHours(item.starts_at, item.ends_at);
              const isPendingApproval = item.status === 'PENDING_HR';

              return (
                <Card key={item.request_id}>
                  {/* Header: Nhân viên, Mã NV, Cửa hàng & Status Badge */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, color: p.text }} numberOfLines={1}>
                        {item.employee_name || 'Nhân viên'}
                      </Text>
                      <Label muted>
                        {item.employee_code || `#${item.employee_id}`} · {storeLabel(item.store_name || item.department_name)}
                      </Label>
                    </View>
                    <View
                      style={{
                        backgroundColor: meta.bg,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    >
                      <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>
                        {meta.label}
                      </Text>
                    </View>
                  </View>

                  {/* Thông tin ngày & khung giờ OT */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AppIcon name="calendar-outline" style={{ fontSize: 14, color: p.muted }} />
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                      {formatDateDMY(item.work_date)}
                    </Text>
                    <Text style={{ color: p.muted }}>·</Text>
                    <AppIcon name="time-outline" style={{ fontSize: 14, color: p.brand }} />
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                      {formatTimeHHmm(item.starts_at)} → {formatTimeHHmm(item.ends_at)} ({durationHours.toFixed(1)}h)
                    </Text>
                  </View>

                  {/* Thông tin đối soát & Hệ số OT */}
                  {item.reconciliation_status === 'VERIFIED' ? (
                    (() => {
                      const mult = getOvertimeMultiplier(item);
                      const verifiedFmt = formatVerifiedHoursDisplay(item.verified_hours, item.verified_microseconds);
                      return (
                        <View
                          style={{
                            backgroundColor: 'rgba(22, 163, 74, 0.08)',
                            padding: 8,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: 'rgba(22, 163, 74, 0.25)',
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <AppIcon name="checkmark-circle" style={{ fontSize: 15, color: '#16a34a' }} />
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#16a34a' }}>
                              Đã đối soát: {verifiedFmt.minutesText} ({verifiedFmt.hoursText})
                            </Text>
                          </View>
                          <View
                            style={{
                              backgroundColor: mult.bg,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 6,
                              borderWidth: 1,
                              borderColor: mult.borderColor,
                            }}
                          >
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: mult.color }}>
                              Hệ số {mult.rate}
                            </Text>
                          </View>
                        </View>
                      );
                    })()
                  ) : item.status === 'APPROVED' ? (
                    (() => {
                      const mult = getOvertimeMultiplier(item);
                      return (
                        <View
                          style={{
                            backgroundColor: 'rgba(217, 119, 6, 0.08)',
                            padding: 8,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: 'rgba(217, 119, 6, 0.2)',
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <AppIcon name="hourglass-outline" style={{ fontSize: 14, color: '#d97706' }} />
                            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: '#d97706' }}>
                              Chờ HR đối soát giờ công
                            </Text>
                          </View>
                          <View
                            style={{
                              backgroundColor: mult.bg,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 6,
                            }}
                          >
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: mult.color }}>
                              Dự kiến {mult.rate}
                            </Text>
                          </View>
                        </View>
                      );
                    })()
                  ) : null}

                  {/* Lý do OT */}
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                    Lý do: <Text style={{ color: p.muted }}>{item.reason}</Text>
                  </Text>
                  {!!item.notes && (
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, fontStyle: 'italic' }}>
                      Ghi chú: {item.notes}
                    </Text>
                  )}

                  {/* Tiến trình duyệt 2 cấp */}
                  {renderOtProgressBox(item)}

                  {/* Thao tác Quản lý: Duyệt (Xanh), Từ chối (Viền đỏ), Chi tiết */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    {/* Nút Xem chi tiết */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Xem chi tiết đơn OT"
                      onPress={() => setDetailItem(item)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 8,
                        backgroundColor: p.bg,
                        borderWidth: 1,
                        borderColor: p.line,
                      }}
                    >
                      <EyeIcon size={14} color={p.muted} />
                      <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text }}>Chi tiết</Text>
                    </Pressable>

                    {/* Nút Duyệt màu xanh & Nút Từ chối viền đỏ */}
                    {isPendingApproval ? (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {/* NÚT TỪ CHỐI VIỀN ĐỎ */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Từ chối đơn OT"
                          onPress={() => {
                            setRejectItem(item);
                            setRejectionReasonInput('');
                          }}
                          disabled={actionBusy}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            paddingVertical: 7,
                            paddingHorizontal: 14,
                            borderRadius: 8,
                            borderWidth: 1.5,
                            borderColor: '#dc2626',
                            backgroundColor: 'transparent',
                          }}
                        >
                          <AppIcon name="close-outline" style={{ fontSize: 14, color: '#dc2626' }} />
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#dc2626' }}>
                            Từ chối
                          </Text>
                        </Pressable>

                        {/* NÚT DUYỆT MÀU XANH */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Phê duyệt đơn OT"
                          onPress={() => setConfirmApproveItem(item)}
                          disabled={actionBusy}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            paddingVertical: 7,
                            paddingHorizontal: 16,
                            borderRadius: 8,
                            backgroundColor: '#16a34a',
                            shadowColor: '#16a34a',
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.2,
                            shadowRadius: 4,
                            elevation: 2,
                          }}
                        >
                          <AppIcon name="checkmark-outline" style={{ fontSize: 14, color: '#ffffff' }} />
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: '#ffffff' }}>
                            Duyệt
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View>
                        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                          {item.status === 'APPROVED' ? 'Đã phê duyệt' : 'Đã xử lý'}
                        </Text>
                      </View>
                    )}
                  </View>
                </Card>
              );
            })
          )}
        </>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: FORM TẠO ĐƠN ĐĂNG KÝ TĂNG CA (OT)                      */}
      {/* ============================================================== */}
      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              backgroundColor: p.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              gap: 14,
              borderWidth: 1,
              borderColor: p.line,
              maxHeight: '90%',
            }}
          >
            {/* Header Modal */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label large>Đăng ký làm thêm giờ (OT)</Label>
              <Pressable
                onPress={() => setShowCreateModal(false)}
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
                <AppIcon name="close-outline" style={{ fontSize: 16, color: p.muted }} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
              {/* Nhân viên áp dụng: Nếu ở Quản lý duyệt OT thì có dropdown dấu (V) chọn nhân viên */}
              {activeScopeTab === 'manager_ot' && isManager ? (
                <View style={{ gap: 6 }}>
                  <Label>Nhân viên thực hiện tăng ca (*) - Quản lý chọn nhân viên</Label>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Chọn nhân viên tăng ca"
                    onPress={() => setEmployeePickerOpen(!employeePickerOpen)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: p.bg,
                      padding: 12,
                      borderRadius: 10,
                      borderWidth: 1.5,
                      borderColor: employeePickerOpen ? p.brand : p.line,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      {selectedEmployee ? (
                        <>
                          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                            {selectedEmployee.full_name} ({selectedEmployee.employee_code || `#${selectedEmployee.employee_id}`})
                          </Text>
                          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, marginTop: 2 }}>
                            {selectedEmployee.position_name || 'Nhân viên'} · {storeLabel(selectedEmployee.store_name || selectedEmployee.department_name)}
                          </Text>
                        </>
                      ) : (
                        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                          -- Nhấn dấu (V) để chọn nhân viên chi nhánh --
                        </Text>
                      )}
                    </View>

                    {/* DẤU (V) DẠNG SVG / CHEVRON XỔ XUỐNG */}
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        backgroundColor: employeePickerOpen ? p.brand : p.card,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: employeePickerOpen ? p.brand : p.line,
                        transform: [{ rotate: employeePickerOpen ? '180deg' : '0deg' }],
                      }}
                    >
                      <AppIcon
                        name="chevron-down-outline"
                        style={{
                          fontSize: 16,
                          color: employeePickerOpen ? '#ffffff' : p.text,
                        }}
                      />
                    </View>
                  </Pressable>

                  {/* DANH SÁCH NHÂN VIÊN XỔ RA KHI BẤM DẤU (V) */}
                  {employeePickerOpen && (
                    <View
                      style={{
                        backgroundColor: p.card,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: p.brand,
                        padding: 8,
                        gap: 8,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.15,
                        shadowRadius: 6,
                        elevation: 5,
                      }}
                    >
                      {/* Ô tìm kiếm nhanh nhân viên */}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: p.bg,
                          borderRadius: 8,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderWidth: 1,
                          borderColor: p.line,
                        }}
                      >
                        <AppIcon name="search-outline" style={{ fontSize: 14, color: p.muted, marginRight: 6 }} />
                        <TextInput
                          placeholder="Tìm theo tên hoặc mã NV..."
                          placeholderTextColor={p.muted}
                          value={employeeSearchText}
                          onChangeText={setEmployeeSearchText}
                          style={{
                            flex: 1,
                            fontFamily: 'BeVietnam',
                            fontSize: 12,
                            color: p.text,
                            padding: 0,
                          }}
                        />
                        {employeeSearchText.length > 0 && (
                          <Pressable onPress={() => setEmployeeSearchText('')} hitSlop={10}>
                            <AppIcon name="close-outline" style={{ fontSize: 13, color: p.muted }} />
                          </Pressable>
                        )}
                      </View>

                      {/* Danh sách cuộn nhân viên */}
                      <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }}>
                        {employeeLoading ? (
                          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, padding: 8, textAlign: 'center' }}>
                            Đang tải danh sách nhân viên...
                          </Text>
                        ) : filteredEmployees.length === 0 ? (
                          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, padding: 8, textAlign: 'center' }}>
                            Không tìm thấy nhân viên phù hợp.
                          </Text>
                        ) : (
                          filteredEmployees.map(emp => {
                            const isSelected = selectedEmployee?.employee_id === emp.employee_id;
                            return (
                              <Pressable
                                key={emp.employee_id}
                                onPress={() => {
                                  setSelectedEmployee(emp);
                                  setEmployeePickerOpen(false);
                                }}
                                style={{
                                  paddingVertical: 8,
                                  paddingHorizontal: 10,
                                  borderRadius: 8,
                                  backgroundColor: isSelected ? p.brandLight : 'transparent',
                                  flexDirection: 'row',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontFamily: isSelected ? 'BeVietnamBold' : 'BeVietnam', fontSize: 13, color: isSelected ? p.brand : p.text }}>
                                    {emp.full_name} ({emp.employee_code || `#${emp.employee_id}`})
                                  </Text>
                                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                                    {emp.position_name || 'Nhân viên'} · {storeLabel(emp.store_name || emp.department_name)}
                                  </Text>
                                </View>
                                {isSelected && (
                                  <AppIcon name="checkmark-outline" style={{ fontSize: 16, color: p.brand }} />
                                )}
                              </Pressable>
                            );
                          })
                        )}
                      </ScrollView>
                    </View>
                  )}
                </View>
              ) : (
                <View style={{ backgroundColor: p.bg, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: p.line }}>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                    {profile?.full_name || 'Nhân viên'} ({profile?.employee_code || `#${profile?.employee_id}`})
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                    {storeLabel(profile?.department_name || profile?.store_name)}
                  </Text>
                </View>
              )}

              {/* Ngày làm việc */}
              <Label>Ngày làm việc OT (*)</Label>
              <Input
                placeholder="YYYY-MM-DD (Ví dụ: 2026-10-30)"
                value={otWorkDate}
                onChangeText={setOtWorkDate}
              />

              {/* Khung giờ OT: Bắt đầu & Kết thúc */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Label>Giờ bắt đầu (*)</Label>
                  <Input
                    placeholder="HH:mm (18:00)"
                    value={otStartTime}
                    onChangeText={setOtStartTime}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Label>Giờ kết thúc (*)</Label>
                  <Input
                    placeholder="HH:mm (20:00)"
                    value={otEndTime}
                    onChangeText={setOtEndTime}
                  />
                </View>
              </View>

              {/* Banner dự kiến số giờ OT */}
              <View
                style={{
                  backgroundColor: estimatedHours > 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(234, 88, 12, 0.1)',
                  padding: 10,
                  borderRadius: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text }}>
                  Số giờ OT dự kiến đăng ký:
                </Text>
                <Text
                  style={{
                    fontFamily: 'BeVietnamBold',
                    fontSize: 14,
                    color: estimatedHours > 0 ? '#16a34a' : '#ea580c',
                  }}
                >
                  {estimatedHours > 0 ? `${estimatedHours.toFixed(2)} giờ` : 'Giờ chưa hợp lệ'}
                </Text>
              </View>

              {/* Lý do OT */}
              <Label>Lý do làm thêm giờ (*) - Tối thiểu 3 ký tự</Label>
              <Input
                placeholder="Nhập lý do làm thêm (Vd: Hỗ trợ kiểm kê kho cuối tháng, bù tải cao điểm)..."
                value={otReason}
                onChangeText={setOtReason}
                multiline
                numberOfLines={3}
              />

              {/* Ghi chú thêm */}
              <Label>Ghi chú bổ sung (Không bắt buộc)</Label>
              <Input
                placeholder="Thêm thông tin hỗ trợ duyệt..."
                value={otNotes}
                onChangeText={setOtNotes}
              />

              <Button
                title={actionBusy ? 'Đang gửi đăng ký…' : 'Gửi đơn đăng ký OT'}
                onPress={() => void handleCreateOt()}
                disabled={actionBusy || estimatedHours <= 0 || otReason.trim().length < 3}
              />
              <Button title="Hủy bỏ" secondary onPress={() => setShowCreateModal(false)} disabled={actionBusy} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 2: XEM CHI TIẾT ĐƠN TĂNG CA (OT)                         */}
      {/* ============================================================== */}
      <Modal visible={!!detailItem} transparent animationType="fade" onRequestClose={() => setDetailItem(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
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
              gap: 12,
              borderWidth: 1,
              borderColor: p.line,
              maxHeight: '85%',
            }}
          >
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label large>Chi tiết đơn tăng ca #{detailItem?.request_id}</Label>
              <Pressable
                onPress={() => setDetailItem(null)}
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
                <AppIcon name="close-outline" style={{ fontSize: 16, color: p.muted }} />
              </Pressable>
            </View>

            {detailItem && (
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                {/* Status Badge Banner */}
                <View
                  style={{
                    backgroundColor: overtimeStatusMeta[detailItem.status]?.bg || p.bg,
                    padding: 12,
                    borderRadius: 10,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: overtimeStatusMeta[detailItem.status]?.color || p.text }}>
                    {overtimeStatusMeta[detailItem.status]?.label || detailItem.status}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: overtimeStatusMeta[detailItem.status]?.color || p.text }}>
                    {overtimeStatusMeta[detailItem.status]?.step}
                  </Text>
                </View>

                {/* Nhân viên & Cửa hàng */}
                <View style={{ gap: 4 }}>
                  <Label muted>NHÂN VIÊN ĐĂNG KÝ</Label>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.text }}>
                    {detailItem.employee_name || 'Nhân viên'} ({detailItem.employee_code || `#${detailItem.employee_id}`})
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                    {storeLabel(detailItem.store_name || detailItem.department_name)}
                  </Text>
                </View>

                {/* Thời gian OT */}
                <View style={{ gap: 4 }}>
                  <Label muted>THỜI GIAN LÀM THÊM GIỜ</Label>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>
                    Ngày: {formatDateDMY(detailItem.work_date)}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.brand }}>
                    Khung giờ: {formatTimeHHmm(detailItem.starts_at)} → {formatTimeHHmm(detailItem.ends_at)} ({calculateOvertimeHours(detailItem.starts_at, detailItem.ends_at).toFixed(1)} giờ)
                  </Text>
                </View>

                {/* Lý do & Ghi chú */}
                <View style={{ gap: 4 }}>
                  <Label muted>LÝ DO ĐĂNG KÝ</Label>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                    {detailItem.reason}
                  </Text>
                  {!!detailItem.notes && (
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                      Ghi chú: {detailItem.notes}
                    </Text>
                  )}
                </View>

                {/* Tiến trình 2 cấp */}
                <View style={{ gap: 4 }}>
                  <Label muted>TIẾN TRÌNH PHÊ DUYỆT 2 CẤP</Label>
                  {renderOtProgressBox(detailItem)}
                </View>

                {/* Section Kết quả Đối soát & Hệ số tính lương OT */}
                {detailItem.status === 'APPROVED' && (
                  <View
                    style={{
                      backgroundColor: detailItem.reconciliation_status === 'VERIFIED'
                        ? 'rgba(22, 163, 74, 0.07)'
                        : 'rgba(37, 99, 235, 0.05)',
                      padding: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: detailItem.reconciliation_status === 'VERIFIED'
                        ? 'rgba(22, 163, 74, 0.3)'
                        : 'rgba(37, 99, 235, 0.2)',
                      gap: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.text, letterSpacing: 0.5 }}>
                        ĐỐI SOÁT & HỆ SỐ TÍNH LƯƠNG
                      </Text>
                      {(() => {
                        const recStatus = detailItem.reconciliation_status || 'PENDING_RECONCILIATION';
                        const recMeta = reconciliationStatusMeta[recStatus] || {
                          label: 'Chờ đối soát',
                          color: '#d97706',
                          bg: 'rgba(217, 119, 6, 0.12)',
                        };
                        return (
                          <View
                            style={{
                              backgroundColor: recMeta.bg,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 6,
                            }}
                          >
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: recMeta.color }}>
                              {recMeta.label}
                            </Text>
                          </View>
                        );
                      })()}
                    </View>

                    {/* Giờ OT đã xác nhận & Hệ số */}
                    {(() => {
                      const mult = getOvertimeMultiplier(detailItem);
                      const verifiedFmt = formatVerifiedHoursDisplay(
                        detailItem.verified_hours,
                        detailItem.verified_microseconds
                      );
                      const isVerified = detailItem.reconciliation_status === 'VERIFIED';

                      return (
                        <>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                            <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                              Giờ OT hợp lệ tính lương:
                            </Text>
                            <Text
                              style={{
                                fontFamily: 'BeVietnamBold',
                                fontSize: 15,
                                color: isVerified ? '#16a34a' : p.muted,
                              }}
                            >
                              {isVerified ? `${verifiedFmt.minutesText} (${verifiedFmt.hoursText})` : 'Chưa đối soát'}
                            </Text>
                          </View>

                          {/* Hệ số tính lương */}
                          <View
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              paddingVertical: 8,
                              paddingHorizontal: 10,
                              borderRadius: 8,
                              backgroundColor: mult.bg,
                              borderWidth: 1,
                              borderColor: mult.borderColor,
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: mult.color }}>
                                Hệ số tính lương OT: {mult.rate}
                              </Text>
                              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                                {mult.label}
                              </Text>
                            </View>
                            <View
                              style={{
                                width: 38,
                                height: 38,
                                borderRadius: 19,
                                backgroundColor: mult.color,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: '#fff' }}>
                                {mult.rate}
                              </Text>
                            </View>
                          </View>

                          {/* Quyết định / Ghi chú đối soát của HR */}
                          {!!detailItem.reconciliation_reason && (
                            <View style={{ backgroundColor: p.bg, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: p.line }}>
                              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: p.muted }}>
                                Ghi chú HR đối soát:
                              </Text>
                              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.text }}>
                                {detailItem.reconciliation_reason}
                              </Text>
                            </View>
                          )}

                          {/* Nguyên tắc tính lương OT */}
                          <View style={{ backgroundColor: p.bg, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: p.line }}>
                            <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted, lineHeight: 16 }}>
                              💡 <Text style={{ fontFamily: 'BeVietnamBold', color: p.brand }}>Công thức:</Text> Tiền lương OT = Giờ OT hợp lệ ({isVerified ? verifiedFmt.hoursText : 'giờ đối soát'}) × Tiền lương giờ thực trả × Hệ số ({mult.rate}).
                            </Text>
                          </View>
                        </>
                      );
                    })()}
                  </View>
                )}

                {/* Thời gian gửi đơn */}
                {detailItem.created_at && (
                  <Text style={{ fontSize: 11, color: p.muted, fontFamily: 'BeVietnam', marginTop: 4 }}>
                    Gửi lúc: {formatDateTimeDMY(detailItem.created_at)}
                  </Text>
                )}

                <Button title="Đóng chi tiết" secondary onPress={() => setDetailItem(null)} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 3: XÁC NHẬN DUYỆT ĐƠN OT (QUẢN LÝ)                       */}
      {/* ============================================================== */}
      <Modal visible={!!confirmApproveItem} transparent animationType="fade" onRequestClose={() => setConfirmApproveItem(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 440,
              backgroundColor: p.card,
              borderRadius: 20,
              padding: 20,
              gap: 14,
              borderWidth: 1,
              borderColor: p.line,
            }}
          >
            <Label large>Xác nhận phê duyệt OT</Label>
            {confirmApproveItem && (
              <View style={{ backgroundColor: 'rgba(22, 163, 74, 0.1)', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(22, 163, 74, 0.2)' }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: '#166534' }}>
                  Phê duyệt đơn OT #{confirmApproveItem.request_id} của nhân viên{' '}
                  <Text style={{ fontFamily: 'BeVietnamBold' }}>{confirmApproveItem.employee_name}</Text>
                  {'\n'}Ngày: {formatDateDMY(confirmApproveItem.work_date)} ({formatTimeHHmm(confirmApproveItem.starts_at)} → {formatTimeHHmm(confirmApproveItem.ends_at)} - {calculateOvertimeHours(confirmApproveItem.starts_at, confirmApproveItem.ends_at).toFixed(1)}h).
                </Text>
              </View>
            )}
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
              Đơn sau khi duyệt sẽ chính thức có hiệu lực và được đối chiếu với chấm công thực tế để tính lương.
            </Text>

            <Button
              title={actionBusy ? 'Đang duyệt…' : 'Xác nhận phê duyệt (Cấp 2)'}
              onPress={() => confirmApproveItem && void handleApproveOt(confirmApproveItem.request_id)}
              disabled={actionBusy}
            />
            <Button title="Quay lại" secondary onPress={() => setConfirmApproveItem(null)} disabled={actionBusy} />
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 4: TỪ CHỐI ĐƠN OT (QUẢN LÝ)                              */}
      {/* ============================================================== */}
      <Modal visible={!!rejectItem} transparent animationType="fade" onRequestClose={() => setRejectItem(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 440,
              backgroundColor: p.card,
              borderRadius: 20,
              padding: 20,
              gap: 14,
              borderWidth: 1,
              borderColor: p.line,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label large>Từ chối đơn tăng ca (OT)</Label>
              <Pressable
                onPress={() => setRejectItem(null)}
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
                <AppIcon name="close-outline" style={{ fontSize: 16, color: p.muted }} />
              </Pressable>
            </View>

            {rejectItem && (
              <View style={{ backgroundColor: '#fee2e2', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5' }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: '#7f1d1d' }}>
                  Từ chối đơn OT #{rejectItem.request_id} của nhân viên{' '}
                  <Text style={{ fontFamily: 'BeVietnamBold', color: '#991b1b' }}>{rejectItem.employee_name}</Text> (
                  {formatDateDMY(rejectItem.work_date)}, {formatTimeHHmm(rejectItem.starts_at)} → {formatTimeHHmm(rejectItem.ends_at)}).
                </Text>
              </View>
            )}

            <Label>Lý do từ chối (*) - Bắt buộc</Label>
            <Input
              placeholder="Nhập lý do từ chối (Vd: Không đủ định biên, kế hoạch thay đổi)..."
              value={rejectionReasonInput}
              onChangeText={setRejectionReasonInput}
              multiline
              numberOfLines={3}
            />

            <Button
              title={actionBusy ? 'Đang xử lý…' : 'Xác nhận từ chối'}
              onPress={() => void handleRejectOt()}
              disabled={actionBusy || rejectionReasonInput.trim().length < 3}
            />
            <Button title="Hủy bỏ" secondary onPress={() => setRejectItem(null)} disabled={actionBusy} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

