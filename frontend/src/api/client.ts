import { createApi } from "@rack/shared/client";
import { clearRecent } from "../lib/recentSearches";
import { clearSnapshots } from "../lib/snapshot";

export { ApiError, feedQueryString, UnauthorizedError } from "@rack/shared/client";

/** The web app's API: same origin, HttpOnly session cookie + the CSRF header the API requires. */
export const api = createApi({
  baseUrl: "",
  credentials: "same-origin",
  authHeaders: () => ({ "X-Requested-With": "rack" }),
  onSignedOut: () => {
    clearSnapshots();
    clearRecent(); // the next person on this browser mustn't see them
  },
});
