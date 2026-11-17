// Rack's icons in the app: Basil (the owner's own pack, from @rack/private) when present, else
// SF Symbols. Same roles as the web's components/icons/basil-map.json. Outline at rest, solid
// when active (DESIGN.md "Icons"). Roles Basil has no icon for always use SF Symbols.
import privateAssets from '@rack/private';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';
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

interface Props {
  name: IconName;
  filled?: boolean;
  /** 22 in bars and the action row, 16 in menus, 14-18 inline, 24 in empty states */
  size?: number;
  color: ColorValue;
  /** VoiceOver label; omit for decorative icons next to text */
  label?: string;
}

export function Icon({ name, filled = false, size = 22, color, label }: Props) {
  const basil = privateAssets.basil[name];
  const a11y = label ? { accessible: true, accessibilityLabel: label } : { accessible: false };
  if (basil) {
    const markup = filled ? basil.solid : basil.outline;
    return (
      <SvgXml
        {...a11y}
        xml={`<svg viewBox="0 0 24 24">${markup}</svg>`}
        width={size}
        height={size}
        color={String(color)}
      />
    );
  }
  const [outline, solid] = SF[name];
  return <SymbolView {...a11y} name={filled ? solid : outline} size={size} tintColor={color} />;
}
