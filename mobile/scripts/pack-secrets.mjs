#!/usr/bin/env node
// Packs your private assets (assets/private: Neue Montreal, Basil) for the GitHub Actions build,
// which only sees the public repo. GitHub secrets hold at most 48 KB each, so the folder is
// tar+gzip'd, base64'd and split into chunks for the secrets RACK_ASSETS_1, RACK_ASSETS_2, ...
// The chunks go to mobile/.ci-secrets/ (git-ignored). Paste each into the repository secret of
// the same name (Settings > Secrets and variables > Actions), or with the GitHub CLI:
//   gh secret set RACK_ASSETS_1 < mobile/.ci-secrets/RACK_ASSETS_1.txt
// Run `npm run private-assets` first. Usage (from mobile/): npm run pack-secrets
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(app, "assets/private");
const out = join(app, ".ci-secrets");
const CHUNK = 45_000; // characters per secret, under GitHub's 48 KB
export const MAX_CHUNKS = 8; // the workflow reads RACK_ASSETS_1..8

if (!existsSync(join(src, "index.ts"))) {
  console.error("No assets/private/index.ts: run `npm run private-assets` first.");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const tgz = join(out, "private.tgz");
// everything the app imports (README.md is tracked anyway). Relative paths from inside the
// folder: Git Bash's tar reads "C:\..." as a remote host.
const parts = ["index.ts", "basil.json", "bars", "fonts"].filter((p) => existsSync(join(src, p)));
execFileSync("tar", ["-czf", "../../.ci-secrets/private.tgz", ...parts], { cwd: src });
const b64 = readFileSync(tgz).toString("base64");
rmSync(tgz);
const chunks = [];
for (let i = 0; i < b64.length; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));
if (chunks.length > MAX_CHUNKS) {
  console.error(`Needs ${chunks.length} secrets; the workflow reads ${MAX_CHUNKS}. Raise MAX_CHUNKS in both places.`);
  process.exit(1);
}
chunks.forEach((c, i) => writeFileSync(join(out, `RACK_ASSETS_${i + 1}.txt`), c));
console.log(`${chunks.length} secrets (${b64.length} characters) in mobile/.ci-secrets/: RACK_ASSETS_1..${chunks.length}`);
