export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// GitHub refuses to render its authorization page inside the embedded Preview
// iframe. Always request a new top-level browsing context and never fall back
// to changing the current iframe location.
export const startLogin = () => {
  return window.open("/api/oauth/github/start", "_blank", "noopener,noreferrer");
};
