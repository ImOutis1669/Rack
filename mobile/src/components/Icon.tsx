// Rack's icons in the app: Basil (the owner's own pack, from @rack/private) when present, else
// SF Symbols. Same roles as the web's components/icons/basil-map.json. Outline at rest, solid
// when active (DESIGN.md "Icons"). Roles Basil has no icon for always use SF Symbols.
import privateAssets from '@rack/private';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { View, type ColorValue } from 'react-native';
import { SvgXml } from 'react-native-svg';

/** SF Symbol per role: [outline, filled]. */
export const SF: Record<string, [SFSymbol, SFSymbol]> = {
  feed: ['square.grid.2x2', 'square.grid.2x2.fill'],
  hunts: ['scope', 'scope'],
  bookmark: ['bookmark', 'bookmark.fill'],
  wardrobe: ['tshirt', 'tshirt.fill'],
  settings: ['gearshape', 'gearshape.fill'],
  close: ['xmark', 'xmark'],
  plus: ['plus', 'plus'],
  check: ['checkmark', 'checkmark'],
  filters: ['slider.horizontal.3', 'slider.horizontal.3'],
  share: ['square.and.arrow.up', 'square.and.arrow.up'],
  search: ['magnifyingglass', 'magnifyingglass'],
  refresh: ['arrow.clockwise', 'arrow.clockwise'],
  edit: ['pencil', 'pencil'],
  bought: ['bag', 'bag.fill'],
  buy: ['bag', 'bag.fill'],
  logout: ['rectangle.portrait.and.arrow.right', 'rectangle.portrait.and.arrow.right'],
  'add-photo': ['photo.badge.plus', 'photo.badge.plus.fill'],
  'chevron-down': ['chevron.down', 'chevron.down'],
  'chevron-left': ['chevron.left', 'chevron.left'],
  'chevron-right': ['chevron.right', 'chevron.right'],
  hide: ['eye.slash', 'eye.slash.fill'],
  mute: ['bell.slash', 'bell.slash.fill'],
  'alerts-on': ['bell', 'bell.fill'],
  pause: ['pause', 'pause.fill'],
  play: ['play', 'play.fill'],
  delete: ['trash', 'trash.fill'],
  sources: ['dot.radiowaves.left.and.right', 'dot.radiowaves.left.and.right'],
  more: ['ellipsis', 'ellipsis'],
  'vote-up': ['arrowshape.up', 'arrowshape.up.fill'],
  'vote-down': ['arrowshape.down', 'arrowshape.down.fill'],
  sort: ['arrow.up.arrow.down', 'arrow.up.arrow.down'],
};

export type IconName = keyof typeof SF;

/** Roles that are always SF Symbols, even with the Basil pack (user's choice: the bookmark, iOS step 5). */
export const SF_ONLY: ReadonlySet<string> = new Set(['bookmark']);

interface Props {
  name: IconName;
  filled?: boolean;
  /** 22 in bars and the action row, 16 in menus, 14-18 inline, 24 in empty states */
  size?: number;
  color: ColorValue;
  /** VoiceOver label; omit for decorative icons next to text */
  label?: string;
  /** Always the SF Symbol, even when Basil has this icon (to match SF neighbours). */
  system?: boolean;
}

export function Icon({ name, filled = false, size = 22, color, label, system = false }: Props) {
  const basil = system || SF_ONLY.has(name) ? undefined : privateAssets.basil[name];
  const a11y = label ? { accessible: true, accessibilityLabel: label } : { accessible: false };
  const [outline, solid] = SF[name];
  // pointerEvents none: an icon never takes the touch from the button around it (the native
  // SF Symbol view swallowed taps on the listing sheet's vote buttons, iOS step 5)
  return (
    <View {...a11y} pointerEvents="none" style={{ width: size, height: size }}>
      {basil ? (
        <SvgXml
          xml={`<svg viewBox="0 0 24 24">${filled ? basil.solid : basil.outline}</svg>`}
          width={size}
          height={size}
          color={String(color)}
        />
      ) : (
        <SymbolView name={filled ? solid : outline} size={size} tintColor={color} />
      )}
    </View>
  );
}
