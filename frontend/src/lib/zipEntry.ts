/** Reads one file out of a .zip in the browser, without uploading the zip: the Vinted import
 *  sends only the liked-items page (~150 kB) instead of the whole export (~100 MB of messages,
 *  invoices and photos). Stored and deflated entries; anything else returns null and the caller
 *  falls back to uploading the file as it is. */
export async function readZipEntry(file: Blob, name: string, maxBytes = 20 * 1024 * 1024): Promise<Blob | null> {
  const tailSize = Math.min(file.size, 65557); // end-of-central-directory record + max comment
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirOffset = tail.getUint32(eocd + 16, true);
  if (dirOffset === 0xffffffff || dirOffset + dirSize > file.size) return null; // zip64: not needed here
  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const decoder = new TextDecoder();
  for (let p = 0, n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (dir.getUint32(p, true) !== 0x02014b50) return null;
    const method = dir.getUint16(p + 10, true);
    const compressed = dir.getUint32(p + 20, true);
    const size = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true);
    const extraLen = dir.getUint16(p + 30, true);
    const commentLen = dir.getUint16(p + 32, true);
    const local = dir.getUint32(p + 42, true);
    const entryName = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if (size > maxBytes || compressed > maxBytes) return null;
    const header = new DataView(await file.slice(local, local + 30).arrayBuffer());
    if (header.getUint32(0, true) !== 0x04034b50) return null;
    const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const data = file.slice(start, start + compressed);
    if (method === 0) return data;
    if (method !== 8 || typeof DecompressionStream === "undefined") return null;
    return await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  }
  return null;
}
