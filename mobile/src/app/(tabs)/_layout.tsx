import privateAssets from '@rack/private';
import { NativeTabs } from 'expo-router/native-tabs';
import type { SFSymbol } from 'expo-symbols';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Props for a tab's NativeTabs.Trigger.Icon: the Basil image when the owner's icons are present
 * (outline at rest, solid when selected), else an SF Symbol. NativeTabs only finds the Icon as a
 * direct child of its Trigger, so this returns props, not a wrapper component.
 */
function tabIcon(role: string, sf: { default: SFSymbol; selected: SFSymbol }) {
  const image = privateAssets.barIcons[role];
  return image ? ({ src: image, renderingMode: 'template' } as const) : { sf };
}

// The real iOS tab bar: Liquid Glass on iOS 26, minimises when scrolling down.
export default function TabsLayout() {
  const { colors, customFont } = useTheme();
  const label = customFont ? { fontFamily: 'NeueMontreal-Medium' } : undefined;
  return (
    <NativeTabs tintColor={colors.foreground} labelStyle={label} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(feed)">
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...tabIcon('feed', { default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' })} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="hunts">
        <NativeTabs.Trigger.Label>Hunts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...tabIcon('hunts', { default: 'scope', selected: 'scope' })} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bookmark', selected: 'bookmark.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wardrobe">
        <NativeTabs.Trigger.Label>Wardrobe</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'tshirt', selected: 'tshirt.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
