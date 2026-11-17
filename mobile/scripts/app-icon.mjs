#!/usr/bin/env node
// Renders the iOS app icon (1024 px, opaque) and the splash image from assets/icon.svg.
// Usage (from mobile/): npm run app-icon
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(app, "assets/icon.svg"), "utf8");
const render = (px) => new Resvg(svg, { fitTo: { mode: "width", value: px }, background: "#0A0A0A" }).render().asPng();
writeFileSync(join(app, "assets/images/icon.png"), render(1024));
writeFileSync(join(app, "assets/images/splash-icon.png"), render(512));
console.log("wrote assets/images/icon.png (1024) and splash-icon.png (512)");
