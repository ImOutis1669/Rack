import { useEffect, useRef } from "react";

/** The server refuses photos over 10 MB (backend embeddings/images.py MAX_BYTES). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const LONG_EDGE = 2560;

interface ClipboardLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
  files?: ArrayLike<File> | null;
}

/** Image files on the clipboard (a screenshot, an image copied from a page or from Finder /
 *  Explorer), named so they're recognisable; [] when there are none (text pastes as usual). */
export function imagesFromClipboard(data: ClipboardLike | null | undefined, now = Date.now()): File[] {
  if (!data) return [];
  const found: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const f = item.getAsFile();
    if (f) found.push(f);
  }
  if (!found.length) found.push(...Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/")));
  return found.map((f, i) => {
    const ext = f.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "png";
    const generic = !f.name || /^image\.\w+$/i.test(f.name);
    return generic ? new File([f], `pasted-${now}${found.length > 1 ? `-${i + 1}` : ""}.${ext}`, { type: f.type }) : f;
  });
}

/** Re-saves a photo over the upload limit as a JPEG at most 2560 px on its long edge
 *  (full-screen screenshots are often 10-20 MB as PNG). Smaller files pass through untouched. */
export async function fitForUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES || typeof createImageBitmap === "undefined") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** While `enabled`, Ctrl+V / Cmd+V anywhere on the page hands pasted images to `onImages`
 *  (and doesn't paste them into a focused text field). Text pastes are left alone. */
export function usePasteImages(onImages: (files: File[]) => void, enabled = true): void {
  const handler = useRef(onImages);
  handler.current = onImages;
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesFromClipboard(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void Promise.all(files.map(fitForUpload)).then((fitted) => handler.current(fitted));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enabled]);
}
