import { Platform, View } from 'react-native';

interface EyeIconProps {
  size?: number;
  color?: string;
}

export function EyeIcon({ size = 16, color = 'currentColor' }: EyeIconProps) {
  if (Platform.OS === 'web') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: 'block' }}
      >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  // Native layout: curved eye outline with inner pupil
  const outerWidth = size * 1.15;
  const outerHeight = size * 0.72;
  const pupilSize = size * 0.32;

  return (
    <View
      style={{
        width: outerWidth,
        height: outerHeight,
        borderRadius: outerHeight / 2,
        borderWidth: 1.6,
        borderColor: color === 'currentColor' ? '#52525b' : color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: pupilSize,
          height: pupilSize,
          borderRadius: pupilSize / 2,
          backgroundColor: color === 'currentColor' ? '#52525b' : color,
        }}
      />
    </View>
  );
}
