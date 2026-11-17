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
    proxy: { "/api": "http://localhost:8000" },
  },
  test: {
    environment: "node",
  },
});
