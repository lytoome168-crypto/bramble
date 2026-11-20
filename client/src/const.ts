export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// GitHub refuses to render its authorization page inside the embedded Preview
// iframe. Open the server-side OAuth start route in a top-level tab instead;
// the callback sets the shared application cookie on the Bramble origin.
export const startLogin = () => {
  const authWindow = window.open("/api/oauth/github/start", "_blank", "noopener,noreferrer");
  if (!authWindow) {
    // Popup blockers may prevent a new tab. This same-window fallback avoids
    // touching the cross-origin parent frame, which browsers forbid.
    window.location.assign("/api/oauth/github/start");
  }
};
