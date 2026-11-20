export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the GitHub OAuth login only from an explicit user action or an
// unauthorized API response. The server creates and validates the CSRF state
// cookie before redirecting to GitHub.
export const startLogin = () => {
  window.location.assign("/api/oauth/github/start");
};
