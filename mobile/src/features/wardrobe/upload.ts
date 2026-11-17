import type { UploadFile } from '@rack/shared/client';

/** The parts of an expo-image-picker asset an upload needs. */
export interface PickedPhoto {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
}

/**
 * A picked photo as a multipart file part. The picker hands out JPEGs (compatible mode), but
 * names and types can be missing or still say HEIC: fall back to "photo-N.jpg" / image/jpeg.
 */
export function toUpload(a: PickedPhoto, i: number): UploadFile {
  const name = a.fileName && /\.(jpe?g|png|webp)$/i.test(a.fileName) ? a.fileName : `photo-${i + 1}.jpg`;
  const type = a.mimeType && /^image\/(jpeg|png|webp)$/.test(a.mimeType) ? a.mimeType : 'image/jpeg';
  return { uri: a.uri, name, type };
}
