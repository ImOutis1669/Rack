import type { ImageSourcePropType } from 'react-native';

/** One Basil icon: SVG path markup on a 24x24 viewBox, drawn in currentColor. */
export interface BasilIcon {
  outline: string;
  solid: string;
}

/**
 * The owner's licensed font and icon files, built by `npm run private-assets` into git-ignored
 * assets/private/ and imported as `@rack/private`. Empty when they're missing (fallback.ts):
 * the app then uses SF Pro and SF Symbols.
 */
export interface PrivateAssets {
  /** expo-font map: family name -> font file. Empty, or all of NeueMontreal-Regular/Medium/Bold. */
  fonts: Record<string, number>;
  /** Basil icons by role (frontend/src/components/icons/basil-map.json roles). */
  basil: Record<string, BasilIcon>;
  /** Images for native bars (tab bar, header buttons) by role: outline at rest, solid when selected. */
  barIcons: Record<string, { default: ImageSourcePropType; selected: ImageSourcePropType }>;
}
