import { createApi } from "@rack/shared/client";
import { clearSnapshots } from "../lib/snapshot";

export { feedQueryString, UnauthorizedError } from "@rack/shared/client";

/** The web app's API: same origin, HttpOnly session cookie + the CSRF header the API requires. */
export const api = createApi({
  baseUrl: "",
  credentials: "same-origin",
  authHeaders: () => ({ "X-Requested-With": "rack" }),
  onSignedOut: () => clearSnapshots(),
});
