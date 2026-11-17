// @rack/shared: code the web app (frontend/) and the iOS app (mobile/) both use.
// Rules: plain TypeScript, no runtime dependencies, no DOM, no React Native. Anything that needs
// a platform API (storage, fetch credentials, sharing) takes it as a parameter instead.
// Import by path, e.g. `import { formatPrice } from "@rack/shared/format"`. Filled in iOS step 2.

/** Bumped when the shared package's public surface changes in a way both apps must follow. */
export const SHARED_API_VERSION = 1;
