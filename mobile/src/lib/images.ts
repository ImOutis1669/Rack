import type { ImageSource } from 'expo-image';

import type { Session } from './session';

/** expo-image source for one of Rack's own image routes (/api/...): needs the token. */
export function apiImage(session: Session, path: string | null | undefined): ImageSource | undefined {
  if (!path) return undefined;
  if (!path.startsWith('/')) return { uri: path }; // a marketplace CDN photo: no token
  const uri = `${session.server}${path}`;
  return { uri, headers: session.imageHeaders(), cacheKey: uri };
}
