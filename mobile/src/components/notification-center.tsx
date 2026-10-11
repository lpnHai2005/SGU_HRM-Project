import { useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  Pressable,
  Switch,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useNotifications } from '@/contexts/notifications';
import { usePalette, Card, Badge, Button } from '@/components/attendance-ui';
import { type AppNotificationItem, type AppNotificationType } from '@/services/notifications';

interface Props {
  visible: boolean;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const d = new Date(ts);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function getNotificationMeta(type: AppNotificationType): {
  label: string;
  variant: 'warning' | 'success' | 'brand' | 'danger' | 'neutral';
} {
  switch (type) {
    case 'leave_approval':
      return { label: 'Duyệt đơn', variant: 'warning' };
    case 'leave_status':
      return { label: 'Đơn phép', variant: 'success' };
    case 'attendance_reminder':
      return { label: 'Chấm công', variant: 'brand' };
    case 'attendance_alert':
      return { label: 'Cảnh báo', variant: 'danger' };
    case 'payroll':
      return { label: 'Phiếu lương', variant: 'neutral' };
    default:
      return { label: 'Hệ thống', variant: 'neutral' };
  }
}

export function NotificationCenterModal({ visible, onClose }: Props) {
  const p = usePalette();
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    permissionGranted,
    pushToken,
    prefs,
    isManagerUser,
    updatePrefs,
    requestPermission,
    markAsRead,
    markAllAsRead,
    clearAll,
    triggerTestNotification,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'approvals' | 'attendance' | 'settings'>('all');
  const [testSending, setTestSending] = useState(false);

  const filteredNotifs = notifications.filter(item => {
    if (activeTab === 'unread') return !item.read;
    if (activeTab === 'approvals') return item.type === 'leave_approval' || item.type === 'leave_status';
    if (activeTab === 'attendance') return item.type === 'attendance_reminder' || item.type === 'attendance_alert';
    return true;
  });

  const handleItemPress = (item: AppNotificationItem) => {
    markAsRead(item.id);
    onClose();
    if (item.actionUrl) {
      setTimeout(() => {
        try {
          router.push(item.actionUrl as any);
        } catch (err) {
          console.warn('Navigation error:', err);
        }
      }, 120);
    }
  };

  const handleTestNotification = async (type: AppNotificationType) => {
    setTestSending(true);
    try {
      await triggerTestNotification(type);
    } finally {
      setTestSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: p.bg }]}>
          {/* Header without redundant icons */}
          <View style={[styles.header, { borderBottomColor: p.line }]}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.headerTitle, { color: p.text }]}>Trung tâm Thông báo</Text>
                {unreadCount > 0 && (
                  <Badge label={`${unreadCount} mới`} variant="danger" size="sm" />
                )}
              </View>
              <Text style={[styles.headerSub, { color: p.muted }]}>
                Cập nhật ca làm việc, đơn từ & phiếu lương
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Đóng thông báo"
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: p.card, borderColor: p.line }]}
            >
              <Text style={{ fontSize: 14, color: p.text, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </View>

          {/* Navigation Filter Tabs without redundant emojis */}
          <View style={[styles.tabsRow, { borderBottomColor: p.line }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              <Pressable
                onPress={() => setActiveTab('all')}
                style={[
                  styles.tabChip,
                  activeTab === 'all'
                    ? { backgroundColor: p.brand, borderColor: p.brand }
                    : { backgroundColor: p.card, borderColor: p.line },
                ]}
              >
                <Text
                  style={[
                    styles.tabChipText,
                    activeTab === 'all' ? { color: '#fff', fontWeight: '700' } : { color: p.text },
                  ]}
                >
                  Tất cả ({notifications.length})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('unread')}
                style={[
                  styles.tabChip,
                  activeTab === 'unread'
                    ? { backgroundColor: p.brand, borderColor: p.brand }
                    : { backgroundColor: p.card, borderColor: p.line },
                ]}
              >
                <Text
                  style={[
                    styles.tabChipText,
                    activeTab === 'unread' ? { color: '#fff', fontWeight: '700' } : { color: p.text },
                  ]}
                >
                  Chưa đọc ({unreadCount})
                </Text>
              </Pressable>

              {isManagerUser && (
                <Pressable
                  onPress={() => setActiveTab('approvals')}
                  style={[
                    styles.tabChip,
                    activeTab === 'approvals'
                      ? { backgroundColor: p.brand, borderColor: p.brand }
                      : { backgroundColor: p.card, borderColor: p.line },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabChipText,
                      activeTab === 'approvals' ? { color: '#fff', fontWeight: '700' } : { color: p.text },
                    ]}
                  >
                    Duyệt đơn
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => setActiveTab('attendance')}
                style={[
                  styles.tabChip,
                  activeTab === 'attendance'
                    ? { backgroundColor: p.brand, borderColor: p.brand }
                    : { backgroundColor: p.card, borderColor: p.line },
                ]}
              >
                <Text
                  style={[
                    styles.tabChipText,
                    activeTab === 'attendance' ? { color: '#fff', fontWeight: '700' } : { color: p.text },
                  ]}
                >
                  Chấm công
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('settings')}
                style={[
                  styles.tabChip,
                  activeTab === 'settings'
                    ? { backgroundColor: p.brand, borderColor: p.brand }
                    : { backgroundColor: p.card, borderColor: p.line },
                ]}
              >
                <Text
                  style={[
                    styles.tabChipText,
                    activeTab === 'settings' ? { color: '#fff', fontWeight: '700' } : { color: p.text },
                  ]}
                >
                  Cài đặt
                </Text>
              </Pressable>
            </ScrollView>
          </View>

          {/* Content Body */}
          {activeTab === 'settings' ? (
            /* Push Notification Settings & Test Panel */
            <ScrollView contentContainerStyle={styles.settingsContent}>
              {/* Permission & Status Card */}
              <Card low style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[styles.sectionTitle, { color: p.text }]}>Trạng thái Push Notifications</Text>
                  <Badge
                    label={permissionGranted ? 'Hoạt động' : 'Chưa cấp quyền'}
                    variant={permissionGranted ? 'success' : 'danger'}
                  />
                </View>

                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted, lineHeight: 18 }}>
                  {permissionGranted
                    ? 'Ứng dụng đã sẵn sàng nhận thông báo đẩy. Bạn sẽ nhận thông báo khi có việc cần xử lý hoặc sắp tới ca làm.'
                    : 'Quyền thông báo chưa được bật. Vui lòng cấp quyền để nhận cảnh báo kịp thời.'}
                </Text>

                {!permissionGranted && (
                  <Button
                    title="Cấp quyền thông báo ngay"
                    variant="brand"
                    onPress={() => void requestPermission()}
                  />
                )}

                {pushToken ? (
                  <View style={{ backgroundColor: p.surfaceLow, padding: 10, borderRadius: 8, gap: 4 }}>
                    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: p.muted }}>MÃ EXPO PUSH TOKEN:</Text>
                    <Text numberOfLines={2} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.brand, letterSpacing: 0.5 }}>
                      {pushToken}
                    </Text>
                  </View>
                ) : null}
              </Card>

              {/* Channels & Preferences Switches */}
              <Card low style={{ gap: 14 }}>
                <Text style={[styles.sectionTitle, { color: p.text }]}>Tùy chọn nhận thông báo</Text>

                <View style={styles.prefRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.prefLabel, { color: p.text }]}>Cho phép thông báo đẩy</Text>
                    <Text style={[styles.prefDesc, { color: p.muted }]}>Bật hoặc tạm ngưng toàn bộ thông báo của TechZone</Text>
                  </View>
                  <Switch
                    value={prefs.enabled}
                    onValueChange={val => updatePrefs({ enabled: val })}
                    trackColor={{ false: '#cbd5e1', true: p.brand }}
                  />
                </View>

                <View style={[styles.prefDivider, { backgroundColor: p.line }]} />

                <View style={styles.prefRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.prefLabel, { color: p.text }]}>Nhắc nhở chấm công ca làm việc</Text>
                    <Text style={[styles.prefDesc, { color: p.muted }]}>Nhắc trước giờ vào ca và khi kết thúc ca làm</Text>
                  </View>
                  <Switch
                    value={prefs.attendanceReminders}
                    disabled={!prefs.enabled}
                    onValueChange={val => updatePrefs({ attendanceReminders: val })}
                    trackColor={{ false: '#cbd5e1', true: p.brand }}
                  />
                </View>

                {isManagerUser && (
                  <>
                    <View style={[styles.prefDivider, { backgroundColor: p.line }]} />
                    <View style={styles.prefRow}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={[styles.prefLabel, { color: p.text }]}>Đơn nghỉ phép chờ phê duyệt (Quản lý)</Text>
                        <Text style={[styles.prefDesc, { color: p.muted }]}>Thông báo ngay khi nhân viên nộp đơn cần duyệt</Text>
                      </View>
                      <Switch
                        value={prefs.leaveApprovals}
                        disabled={!prefs.enabled}
                        onValueChange={val => updatePrefs({ leaveApprovals: val })}
                        trackColor={{ false: '#cbd5e1', true: p.brand }}
                      />
                    </View>
                  </>
                )}

                <View style={[styles.prefDivider, { backgroundColor: p.line }]} />

                <View style={styles.prefRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.prefLabel, { color: p.text }]}>Kết quả phê duyệt đơn nghỉ phép</Text>
                    <Text style={[styles.prefDesc, { color: p.muted }]}>Nhận kết quả khi CHT duyệt Cấp 1 hoặc HR duyệt Cấp 2</Text>
                  </View>
                  <Switch
                    value={prefs.leaveStatusUpdates}
                    disabled={!prefs.enabled}
                    onValueChange={val => updatePrefs({ leaveStatusUpdates: val })}
                    trackColor={{ false: '#cbd5e1', true: p.brand }}
                  />
                </View>

                <View style={[styles.prefDivider, { backgroundColor: p.line }]} />

                <View style={styles.prefRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.prefLabel, { color: p.text }]}>Phát hành phiếu lương hàng tháng</Text>
                    <Text style={[styles.prefDesc, { color: p.muted }]}>Báo khi phòng nhân sự chốt kỳ công và phát hành lương</Text>
                  </View>
                  <Switch
                    value={prefs.payrollAlerts}
                    disabled={!prefs.enabled}
                    onValueChange={val => updatePrefs({ payrollAlerts: val })}
                    trackColor={{ false: '#cbd5e1', true: p.brand }}
                  />
                </View>
              </Card>

              {/* Test Notification Simulator */}
              <Card low style={{ gap: 12 }}>
                <Text style={[styles.sectionTitle, { color: p.text }]}>Thử nghiệm bắn thông báo</Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                  Chạm vào nút để kích hoạt thông báo tức thì lên màn hình:
                </Text>

                <View style={{ gap: 8 }}>
                  {isManagerUser && (
                    <Button
                      title="Gửi test: Đơn nghỉ phép chờ duyệt"
                      disabled={testSending}
                      secondary
                      onPress={() => handleTestNotification('leave_approval')}
                    />
                  )}
                  <Button
                    title="Gửi test: Nhắc nhở chấm công vào ca"
                    disabled={testSending}
                    secondary
                    onPress={() => handleTestNotification('attendance_reminder')}
                  />
                  <Button
                    title="Gửi test: Kết quả duyệt đơn nghỉ phép"
                    disabled={testSending}
                    secondary
                    onPress={() => handleTestNotification('leave_status')}
                  />
                  <Button
                    title="Gửi test: Phát hành bảng lương mới"
                    disabled={testSending}
                    secondary
                    onPress={() => handleTestNotification('payroll')}
                  />
                </View>
              </Card>
            </ScrollView>
          ) : (
            /* Notifications List */
            <ScrollView contentContainerStyle={styles.listContent}>
              {/* Quick Actions Header */}
              {notifications.length > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  {unreadCount > 0 ? (
                    <Pressable onPress={markAllAsRead}>
                      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.brand }}>
                        ✓ Đánh dấu tất cả đã đọc
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                      Đã đọc tất cả
                    </Text>
                  )}

                  <Pressable onPress={clearAll}>
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: '#ef4444' }}>
                      Xóa tất cả
                    </Text>
                  </Pressable>
                </View>
              )}

              {filteredNotifs.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyTitle, { color: p.text }]}>
                    {activeTab === 'unread' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào'}
                  </Text>
                  <Text style={[styles.emptySub, { color: p.muted }]}>
                    {activeTab === 'unread'
                      ? 'Tất cả thông báo đều đã được xem.'
                      : 'Các thông báo chấm công, duyệt đơn và bảng lương sẽ xuất hiện tại đây.'}
                  </Text>
                </View>
              ) : (
                filteredNotifs.map(item => {
                  const meta = getNotificationMeta(item.type);
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => handleItemPress(item)}
                      style={({ pressed }) => [
                        styles.notifCard,
                        {
                          backgroundColor: item.read ? p.card : p.card,
                          borderColor: item.read ? p.line : p.brand,
                          borderLeftWidth: item.read ? 1 : 4,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={{ gap: 6 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                            <Badge label={meta.label} variant={meta.variant} size="sm" />
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.itemTitle,
                                {
                                  color: p.text,
                                  fontWeight: item.read ? '600' : '700',
                                  fontFamily: item.read ? 'BeVietnam' : 'BeVietnamBold',
                                },
                              ]}
                            >
                              {item.title}
                            </Text>
                          </View>
                          {!item.read && (
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: p.brand,
                              }}
                            />
                          )}
                        </View>

                        <Text style={[styles.itemBody, { color: item.read ? p.muted : p.text }]}>
                          {item.body}
                        </Text>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                          <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                            {formatTimestamp(item.timestamp)}
                          </Text>

                          {item.actionUrl && (
                            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 11, color: p.brand }}>
                              Xem chi tiết →
                            </Text>
                          )}
                        </View>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Footer Bar */}
          <View style={[styles.footer, { borderTopColor: p.line }]}>
            <Button
              title="Đóng"
              secondary
              onPress={onClose}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Global In-App Notification Banner without redundant emoji bubbles
 */
export function GlobalNotificationBanner() {
  const p = usePalette();
  const router = useRouter();
  const { activeBanner, dismissBanner, markAsRead } = useNotifications();

  if (!activeBanner) return null;

  const handleBannerPress = () => {
    markAsRead(activeBanner.id);
    dismissBanner();
    if (activeBanner.actionUrl) {
      try {
        router.push(activeBanner.actionUrl as any);
      } catch (err) {
        console.warn('Navigation error:', err);
      }
    }
  };

  const meta = getNotificationMeta(activeBanner.type);

  return (
    <View style={styles.bannerWrapper}>
      <Pressable
        onPress={handleBannerPress}
        style={[
          styles.bannerCard,
          {
            backgroundColor: p.card,
            borderColor: p.brand,
            shadowColor: '#000',
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <Badge label={meta.label} variant={meta.variant} size="sm" />

          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 13, fontWeight: '700', color: p.text }}>
              {activeBanner.title}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
              {activeBanner.body}
            </Text>
          </View>
        </View>

        <Pressable hitSlop={12} onPress={dismissBanner} style={{ padding: 6 }}>
          <Text style={{ color: p.muted, fontSize: 14, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    maxHeight: '90%',
    minHeight: '65%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontFamily: 'BeVietnamBold',
    fontSize: 17,
    fontWeight: '700',
  },
  headerSub: {
    fontFamily: 'BeVietnam',
    fontSize: 12,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  tabChipText: {
    fontFamily: 'BeVietnam',
    fontSize: 12,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  settingsContent: {
    padding: 16,
    gap: 14,
  },
  notifCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  itemTitle: {
    fontSize: 13,
    flex: 1,
  },
  itemBody: {
    fontFamily: 'BeVietnam',
    fontSize: 12,
    lineHeight: 17,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontFamily: 'BeVietnamBold',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySub: {
    fontFamily: 'BeVietnam',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  sectionTitle: {
    fontFamily: 'BeVietnamBold',
    fontSize: 14,
    fontWeight: '700',
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  prefLabel: {
    fontFamily: 'BeVietnamBold',
    fontSize: 13,
    fontWeight: '600',
  },
  prefDesc: {
    fontFamily: 'BeVietnam',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  prefDivider: {
    height: 1,
    width: '100%',
  },
  bannerWrapper: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 10,
  },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
});
