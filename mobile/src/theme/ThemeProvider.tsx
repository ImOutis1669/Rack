import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { palette, type Palette } from './colors';
import { textStyle, type Role } from './type';

interface Theme {
  scheme: 'light' | 'dark';
  colors: Palette;
  /** true when the owner's Neue Montreal files are loaded */
  customFont: boolean;
  text: (role: Role) => ReturnType<typeof textStyle>;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ customFont, children }: { customFont: boolean; children: ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = useMemo<Theme>(
    () => ({
      scheme,
      colors: palette(scheme),
      customFont,
      text: (role) => textStyle(role, customFont),
    }),
    [scheme, customFont],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme outside ThemeProvider');
  return t;
}
