declare global {
  interface Window {
    mlbbDesktop?: {
      isDesktop?: boolean;
      platform?: string;
      apiBase?: string;
    };
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function isAbsoluteUrl(path: string) {
  return /^[a-z][a-z\d+\-.]*:/i.test(path);
}

export const API_BASE = trimTrailingSlash(
  typeof window === "undefined" ? "" : window.mlbbDesktop?.apiBase ?? ""
);

export function apiUrl(path: string) {
  if (isAbsoluteUrl(path)) return path;
  return `${API_BASE}${normalizePath(path)}`;
}

export function apiWsUrl(path: string) {
  const normalizedPath = normalizePath(path);
  if (API_BASE) return `${API_BASE.replace(/^http/i, "ws")}${normalizedPath}`;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${normalizedPath}`;
}
