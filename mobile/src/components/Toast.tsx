// A short message above the tab bar (the web's toast): plain text, optional action, then gone.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/lib/useReduceMotion';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

interface ToastMsg {
  text: string;
  action?: { label: string; onPress: () => void };
  ms?: number;
}
const Ctx = createContext<(t: ToastMsg | string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors, text, customFont } = useTheme();
  const reduceMotion = useReduceMotion();

  const show = useCallback(
    (t: ToastMsg | string) => {
      const m = typeof t === 'string' ? { text: t } : t;
      setMsg(m);
      AccessibilityInfo.announceForAccessibility(m.text);
      Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? 0 : 150, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => Animated.timing(opacity, { toValue: 0, duration: reduceMotion ? 0 : 200, useNativeDriver: true }).start(() => setMsg(null)),
        m.ms ?? 3500,
      );
    },
    [opacity, reduceMotion],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {msg ? (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.wrap, { bottom: insets.bottom + 72, opacity }]}>
          <Pressable
            accessibilityRole={msg.action ? 'button' : 'text'}
            onPress={() => {
              msg.action?.onPress();
              setMsg(null);
            }}
            style={[styles.toast, { backgroundColor: colors.foreground }]}>
            <Text style={[text('footnote'), { color: colors.background, flexShrink: 1 }]}>{msg.text}</Text>
            {msg.action ? (
              <Text style={[text('footnote'), font('bold', customFont), { color: colors.background }]}>{msg.action.label}</Text>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
    maxWidth: 480,
  },
});
