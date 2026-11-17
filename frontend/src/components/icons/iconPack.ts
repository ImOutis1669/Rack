// The Basil icon pack the owner's account loads at runtime (lib/ownerAssets.ts). Until then,
// and for friends, Icon falls back to lucide. A tiny store so icons redraw when it arrives.
export type BasilPack = Record<string, { outline: string; solid: string }>;

let pack: BasilPack | undefined;
const listeners = new Set<() => void>();

export function setIconPack(next: BasilPack | undefined): void {
  pack = next;
  for (const l of listeners) l();
}

export const getIconPack = (): BasilPack | undefined => pack;

export function subscribeIconPack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
