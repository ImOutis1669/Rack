import { describe, expect, it } from "vitest";
import { readZipEntry } from "./zipEntry";

/** A stored (uncompressed) zip, built by hand: enough to test the directory walk. */
function storedZip(files: Record<string, string>): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const dirs: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name);
    const d = enc.encode(text);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint32(18, d.length, true);
    local.setUint32(22, d.length, true);
    local.setUint16(26, n.length, true);
    locals.push(new Uint8Array(local.buffer), n, d);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint32(20, d.length, true);
    dir.setUint32(24, d.length, true);
    dir.setUint16(28, n.length, true);
    dir.setUint32(42, offset, true);
    dirs.push(new Uint8Array(dir.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const dirSize = dirs.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...locals, ...dirs, new Uint8Array(end.buffer)].map((u) => u.slice().buffer));
}

describe("reading one file from a zip", () => {
  const zip = storedZip({ "messages/index.html": "private", "favourite_items/index.html": "<a>likes</a>" });

  it("returns only the entry asked for", async () => {
    expect(await (await readZipEntry(zip, "favourite_items/index.html"))?.text()).toBe("<a>likes</a>");
  });

  it("returns null when the entry or the zip isn't there", async () => {
    expect(await readZipEntry(zip, "missing.html")).toBeNull();
    expect(await readZipEntry(new Blob(["not a zip"]), "favourite_items/index.html")).toBeNull();
  });

  it("refuses entries over the size limit", async () => {
    expect(await readZipEntry(zip, "favourite_items/index.html", 3)).toBeNull();
  });
});
