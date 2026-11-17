// @rack/shared: code the web app (frontend/) and the iOS app (mobile/) both use.
// Rules: plain TypeScript, no runtime dependencies, no React or React Native. Of the browser
// APIs, only those React Native also has are allowed (fetch, Response, FormData, URL,
// URLSearchParams, timers): that's why tsconfig includes the "DOM" lib. Anything else that needs
// the platform (storage, share sheet, auth) is passed in, e.g. createApi({ authHeaders }).
// Import by path, e.g. `import { formatGBP } from "@rack/shared/format"`.
//
// Modules: types, client (createApi), format, units, landed, seller, vote, hunts, bought,
// tasteItem, wardrobeValue, trend, grid, thumbs, safe, seen, share, snapshot, sheetDrag.

/** Bumped when the shared package's public surface changes in a way both apps must follow. */
export const SHARED_API_VERSION = 1;
