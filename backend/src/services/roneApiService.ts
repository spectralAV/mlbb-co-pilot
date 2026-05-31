import { RONE_API_BASE } from "../config.js";

export type RoneRequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: unknown;
  authorization?: string;
};

export class RoneApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
  }
}

function appendQuery(url: URL, query: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const entry of value) if (entry != null && entry !== "") url.searchParams.append(key, String(entry));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const source = payload as Record<string, unknown>;
    const detail = source.detail;
    if (typeof source.message === "string") return source.message;
    if (typeof source.msg === "string") return source.msg;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

export class RoneApiService {
  constructor(private readonly baseUrl = RONE_API_BASE) {}

  async request<T>(path: string, options: RoneRequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    appendQuery(url, options.query);

    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "user-agent": "MLBB-Co-Pilot/0.4.1-live-cockpit"
    };
    if (options.authorization) headers.authorization = options.authorization;
    if (options.body != null) headers["content-type"] = "application/json";

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new RoneApiError(readErrorMessage(payload, `Rone API ${path} failed: ${response.status}`), response.status, payload);
    }
    return payload as T;
  }
}

export const roneApi = new RoneApiService();
