// Type roles (DESIGN.md "Type"). Neue Montreal from the owner's private assets when present,
// else SF Pro (the system font). Neue Montreal has no tabular figures, so numbers always use
// the system font with tabular-nums (like the web's .tabular).
import type { TextStyle } from 'react-native';

export type Weight = 'regular' | 'medium' | 'bold';

const FAMILY: Record<Weight, string> = {
  regular: 'NeueMontreal-Regular',
  medium: 'NeueMontreal-Medium',
  bold: 'NeueMontreal-Bold',
};
const SYSTEM_WEIGHT: Record<Weight, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '600', // semibold labels: the web maps 600 to Medium too
  bold: '700',
};

/** Font style for a weight. `custom` = the Neue Montreal files are loaded. */
export function font(weight: Weight, custom: boolean): TextStyle {
  // each Neue Montreal file is its own family; a fontWeight on top would make iOS fake it
  return custom ? { fontFamily: FAMILY[weight] } : { fontWeight: SYSTEM_WEIGHT[weight] };
}

/** Prices and counts: system font, tabular figures. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export type Role = 'pageTitle' | 'largeTitle' | 'title' | 'headline' | 'body' | 'footnote' | 'caption';

/** Size, tracking and weight per role. Page titles come from the native large title. */
export const ROLES: Record<Role, { size: number; weight: Weight; tracking?: number; lineHeight?: number }> = {
  pageTitle: { size: 34, weight: 'bold' }, // iOS large title (the web uses 40px; native keeps 34)
  largeTitle: { size: 32, weight: 'bold', tracking: -0.5 },
  title: { size: 20, weight: 'bold' },
  headline: { size: 15, weight: 'medium' },
  body: { size: 15, weight: 'regular', lineHeight: 20 },
  footnote: { size: 13, weight: 'regular' },
  caption: { size: 11, weight: 'regular' },
};

export function textStyle(role: Role, custom: boolean): TextStyle {
  const r = ROLES[role];
  return {
    fontSize: r.size,
    letterSpacing: r.tracking,
    lineHeight: r.lineHeight,
    ...font(r.weight, custom),
  };
}
