import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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

const frontendPort = numberFromEnv(process.env.FRONTEND_PORT, 5173);
const frontendHost = process.env.FRONTEND_HOST ?? "0.0.0.0";
const backendPort = numberFromEnv(process.env.PORT, 8787);
const backendOrigin = process.env.VITE_BACKEND_ORIGIN ?? `http://localhost:${backendPort}`;
const backendWsOrigin = backendOrigin.replace(/^http/, "ws");
const localDnsHostnames = csvFromEnv(process.env.LOCAL_DNS_HOSTNAMES, [
  "localhost",
  "127.0.0.1",
  "::1",
  "mlbb.local",
  "api.mlbb.local",
  "obs.mlbb.local"
]);

export default defineConfig({
  plugins: [react()],
  server: {
    host: frontendHost,
    port: frontendPort,
    allowedHosts: localDnsHostnames,
    proxy: {
      "/api": backendOrigin,
      "/ws": { target: backendWsOrigin, ws: true }
    }
  }
});
