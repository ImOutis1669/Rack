import privateAssets from '@rack/private';
import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/theme/ThemeProvider';

/** Basil image when the owner's icons are present (outline at rest, solid when selected), else an SF Symbol. */
function TabIcon({ role, sf }: { role: string; sf: { default: string; selected: string } }) {
  const image = privateAssets.barIcons[role];
  if (image) return <NativeTabs.Trigger.Icon src={image} renderingMode="template" />;
  return <NativeTabs.Trigger.Icon sf={sf as never} />;
}

// The real iOS tab bar: Liquid Glass on iOS 26, minimises when scrolling down.
export default function TabsLayout() {
  const { colors, customFont } = useTheme();
  const label = customFont ? { fontFamily: 'NeueMontreal-Medium' } : undefined;
  return (
    <NativeTabs tintColor={colors.foreground} labelStyle={label} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(feed)">
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        <TabIcon role="feed" sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="hunts">
        <NativeTabs.Trigger.Label>Hunts</NativeTabs.Trigger.Label>
        <TabIcon role="hunts" sf={{ default: 'scope', selected: 'scope' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <TabIcon role="bookmark" sf={{ default: 'bookmark', selected: 'bookmark.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wardrobe">
        <NativeTabs.Trigger.Label>Wardrobe</NativeTabs.Trigger.Label>
        <TabIcon role="wardrobe" sf={{ default: 'tshirt', selected: 'tshirt.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
