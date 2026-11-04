import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon, AppText as Text } from '@/components/app-icon';
import { usePalette } from '@/components/attendance-ui';

let mobileGreetingShownSession = false;

export function resetMobileGreetingSession() {
  mobileGreetingShownSession = false;
}

export interface MobileGreetingAlertProps {
  userName?: string;
}

export function MobileGreetingAlert({ userName = 'bạn' }: MobileGreetingAlertProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  // 1. Chỉ xuất hiện lần đầu khi đăng nhập vào trang thành công, không hiện lại mỗi lần vào Trang chủ
  const [visible, setVisible] = useState(() => !mobileGreetingShownSession);
  // Xổ từ trên xuống: Bắt đầu từ -180 phía trên màn hình
  const slideAnim = useRef(new Animated.Value(-180)).current;

  useEffect(() => {
    if (visible) {
      mobileGreetingShownSession = true;
      Animated.spring(slideAnim, {
        toValue: 0,
        damping: 18,
        stiffness: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  // Kích hoạt đóng và chạy animation ngược lên trên đỉnh màn hình
  const handleDismiss = () => {
    Animated.timing(slideAnim, {
      toValue: -200,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  };

  // 2. Time-out alert này là 5s nếu người dùng không tự thao tác
  useEffect(() => {
    if (!visible) return;
    const autoDismissTimer = setTimeout(() => {
      handleDismiss();
    }, 5000);
    return () => clearTimeout(autoDismissTimer);
  }, [visible]);

  // 1. Lướt lên để chạy thông báo lên
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6,
      onPanResponderMove: (_, gesture) => {
        // Chỉ cho phép lướt lên phía trên (dy < 0)
        if (gesture.dy < 0) {
          slideAnim.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy < -20 || gesture.vy < -0.3) {
          handleDismiss();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const [timeStr, setTimeStr] = useState(() => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    return `Hôm nay: ${h}:${min} | ${d}/${m}/${y}`;
  });

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const y = now.getFullYear();
      setTimeStr(`Hôm nay: ${h}:${min} | ${d}/${m}/${y}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.floatingOverlay} pointerEvents="box-none">
      {/* 1. Ấn ra ngoài để chạy thông báo lên */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel="Đóng thông báo"
      />

      {/* Dạng nổi xổ từ trên xuống, lướt lên để đóng */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.floatingCard,
          {
            top: insets.top + 10,
            backgroundColor: p.card,
            borderColor: p.line,
            borderLeftColor: '#f59e0b',
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Icon thân thiện buổi sáng (Mặt trời năng lượng) dạng huy hiệu badge */}
        <View style={styles.iconBadge}>
          <AppIcon name="sunny-outline" size={17} color="#d97706" />
        </View>

        <View style={styles.content}>
          {/* Phân cấp thông tin (Hierarchy): Dòng chào nổi bật, đậm nét */}
          <Text style={[styles.title, { color: p.text }]}>
            Chào ngày mới, <Text style={{ fontFamily: 'BeVietnamBold' }}>{userName}</Text>! Chúc bạn một ngày làm việc tràn đầy năng lượng.
          </Text>
          {/* Phân cấp thông tin (Hierarchy): Dòng thời gian mờ & nhỏ hơn */}
          <Text style={[styles.subtext, { color: p.muted }]}>{timeStr}</Text>
        </View>

        <Pressable
          hitSlop={8}
          onPress={handleDismiss}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Đóng thông báo"
        >
          <AppIcon name="close" size={16} color={p.muted} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 99999,
    elevation: 99999,
  },
  floatingCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    borderWidth: 1,
    borderLeftWidth: 3.5,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 10,
  },
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  content: {
    flex: 1,
  },
  title: {
    fontFamily: 'BeVietnamSemiBold',
    fontSize: 12.5,
    lineHeight: 18,
  },
  subtext: {
    fontFamily: 'Mono',
    fontSize: 11,
    marginTop: 3,
    opacity: 0.85,
  },
  closeBtn: {
    padding: 2,
    marginLeft: 2,
  },
});
