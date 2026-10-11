const test = require('node:test');
const assert = require('node:assert/strict');

// Types and default preferences mirroring src/services/notifications.ts
const defaultNotificationPrefs = {
  enabled: true,
  attendanceReminders: true,
  leaveApprovals: true,
  leaveStatusUpdates: true,
  payrollAlerts: true,
};

const channelMap = {
  leave_approval: 'approvals',
  leave_status: 'approvals',
  attendance_reminder: 'reminders',
  attendance_alert: 'alerts',
  payroll: 'default',
  system: 'default',
};

function getStorageKey(baseKey, userKey) {
  const cleanUser = userKey ? userKey.replace(/[^a-zA-Z0-9_-]/g, '_') : 'guest';
  return `${baseKey}.${cleanUser}`;
}

function formatTimestamp(ts, mockNow = Date.now()) {
  const diffSec = Math.floor((mockNow - ts) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const d = new Date(ts);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function filterNotifications(notifications, activeTab, isManager = true) {
  return notifications.filter(item => {
    if (!isManager && (item.type === 'leave_approval' || item.type === 'attendance_alert')) {
      return false;
    }
    if (activeTab === 'unread') return !item.read;
    if (activeTab === 'approvals') return item.type === 'leave_approval' || item.type === 'leave_status';
    if (activeTab === 'attendance') return item.type === 'attendance_reminder' || item.type === 'attendance_alert';
    return true;
  });
}

function shouldDispatchPush(existingNotifications, newParams) {
  return !existingNotifications.some(existing => {
    if (newParams.data?.requestId && existing.data?.requestId === newParams.data.requestId) {
      if (newParams.data?.status && existing.data?.status === newParams.data.status) {
        return true;
      }
    }
    if (newParams.data?.batchKey && existing.data?.batchKey === newParams.data.batchKey) {
      return true;
    }
    return false;
  });
}

test('default notification preferences are all enabled', () => {
  assert.equal(defaultNotificationPrefs.enabled, true);
  assert.equal(defaultNotificationPrefs.attendanceReminders, true);
  assert.equal(defaultNotificationPrefs.leaveApprovals, true);
  assert.equal(defaultNotificationPrefs.leaveStatusUpdates, true);
  assert.equal(defaultNotificationPrefs.payrollAlerts, true);
});

test('channel mapping assigns correct Android channels to alert types', () => {
  assert.equal(channelMap.leave_approval, 'approvals');
  assert.equal(channelMap.leave_status, 'approvals');
  assert.equal(channelMap.attendance_reminder, 'reminders');
  assert.equal(channelMap.attendance_alert, 'alerts');
  assert.equal(channelMap.payroll, 'default');
  assert.equal(channelMap.system, 'default');
});

test('storage key is partitioned per user account', () => {
  assert.equal(getStorageKey('techzone.notifications.list', 'staff_dung'), 'techzone.notifications.list.staff_dung');
  assert.equal(getStorageKey('techzone.notifications.list', 'hr_manager'), 'techzone.notifications.list.hr_manager');
  assert.equal(getStorageKey('techzone.notifications.list', null), 'techzone.notifications.list.guest');
});

test('formatTimestamp provides human readable relative time', () => {
  const now = 1760000000000;
  assert.equal(formatTimestamp(now - 30 * 1000, now), 'Vừa xong');
  assert.equal(formatTimestamp(now - 15 * 60 * 1000, now), '15 phút trước');
  assert.equal(formatTimestamp(now - 3 * 3600 * 1000, now), '3 giờ trước');
  const past = new Date(2026, 9, 10, 8, 30).getTime();
  assert.match(formatTimestamp(past, past + 48 * 3600 * 1000), /10\/10 08:30/);
});

test('filtering notifications by tab behaves predictably and respects manager role', () => {
  const sampleItems = [
    { id: '1', type: 'leave_approval', title: 'Cần duyệt đơn', read: false },
    { id: '2', type: 'leave_status', title: 'Đã duyệt', read: true },
    { id: '3', type: 'attendance_reminder', title: 'Vào ca làm', read: false },
    { id: '4', type: 'payroll', title: 'Bảng lương', read: true },
  ];

  // Manager sees all 4
  const allForManager = filterNotifications(sampleItems, 'all', true);
  assert.equal(allForManager.length, 4);

  // Non-manager employee never sees leave_approval
  const allForEmployee = filterNotifications(sampleItems, 'all', false);
  assert.equal(allForEmployee.length, 3);
  assert.equal(allForEmployee.some(i => i.type === 'leave_approval'), false);

  const unread = filterNotifications(sampleItems, 'unread', true);
  assert.equal(unread.length, 2);
  assert.deepEqual(unread.map(i => i.id), ['1', '3']);
});

test('duplicate and already read notifications are not re-pushed upon login', () => {
  const existingNotifications = [
    {
      id: 'notif-1',
      type: 'leave_approval',
      title: 'Đơn nghỉ phép chờ duyệt',
      read: true, // already read
      data: { batchKey: 'pending-leaves-batch-3', pendingCount: 3 },
    },
    {
      id: 'notif-2',
      type: 'leave_status',
      title: 'Cập nhật đơn nghỉ phép',
      read: true,
      data: { requestId: 101, status: 'HR_APPROVED' },
    },
  ];

  // Re-login check with same batch should NOT push
  const shouldPushBatch3 = shouldDispatchPush(existingNotifications, {
    data: { batchKey: 'pending-leaves-batch-3', pendingCount: 3 },
  });
  assert.equal(shouldPushBatch3, false);

  // New batch count (e.g. new leave request arrived, count is now 4) SHOULD push
  const shouldPushBatch4 = shouldDispatchPush(existingNotifications, {
    data: { batchKey: 'pending-leaves-batch-4', pendingCount: 4 },
  });
  assert.equal(shouldPushBatch4, true);

  // Existing leave status update should NOT re-push
  const shouldPushExistingLeave = shouldDispatchPush(existingNotifications, {
    data: { requestId: 101, status: 'HR_APPROVED' },
  });
  assert.equal(shouldPushExistingLeave, false);

  // New leave request status SHOULD push
  const shouldPushNewLeave = shouldDispatchPush(existingNotifications, {
    data: { requestId: 102, status: 'HR_APPROVED' },
  });
  assert.equal(shouldPushNewLeave, true);
});
