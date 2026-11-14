// Set VITE_API_BASE_URL to the HTTPS origin that securely forwards to the on-site API.
// Leave it empty in development when Vite proxies /api to localhost:8000.
const apiBaseUrl = window.__SCHOOL_ZONE_DESKTOP__
  ? ""
  : (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

export function apiUrl(path) {
  return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
