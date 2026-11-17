/// <reference types="node" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Code shared with the iOS app (mobile/). Keep in sync with tsconfig "paths"; the Dockerfile
    // copies shared/ next to frontend/.
    alias: { "@rack/shared": fileURLToPath(new URL("../shared/src", import.meta.url)) },
  },
  server: {
    // RACK_API_PROXY: point the dev server at another API (e.g. a scratch copy on :8001)
    proxy: { "/api": process.env.RACK_API_PROXY ?? "http://localhost:8000" },
  },
  test: {
    environment: "node",
  },
});
