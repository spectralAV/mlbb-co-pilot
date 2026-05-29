function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csvFromEnv(value: string | undefined, fallback: string[]) {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return entries.length ? Array.from(new Set(entries)) : fallback;
}

export const PORT = numberFromEnv(process.env.PORT, 8787);
export const HOST = process.env.HOST ?? "127.0.0.1";
export const FRONTEND_PORT = numberFromEnv(process.env.FRONTEND_PORT, 5173);
export const LOCAL_DNS_HOSTNAMES = csvFromEnv(process.env.LOCAL_DNS_HOSTNAMES, [
  "mlbb.local",
  "api.mlbb.local",
  "obs.mlbb.local"
]);
export const PRIMARY_LOCAL_DNS_HOSTNAME = LOCAL_DNS_HOSTNAMES[0] ?? "mlbb.local";
export const API_LOCAL_DNS_HOSTNAME = LOCAL_DNS_HOSTNAMES.find((hostname) => hostname.startsWith("api.")) ?? PRIMARY_LOCAL_DNS_HOSTNAME;
export const LOCAL_DNS_FRONTEND_ORIGIN = `http://${PRIMARY_LOCAL_DNS_HOSTNAME}:${FRONTEND_PORT}`;
export const LOCAL_DNS_BACKEND_ORIGIN = `http://${API_LOCAL_DNS_HOSTNAME}:${PORT}`;
export const MLBB_IO_BASE = "https://mlbb.io";
