import { monitorEventLoopDelay } from "node:perf_hooks";
import os from "node:os";

type EndpointStat = {
  method: string;
  path: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  durations: number[];
  statusCodes: Record<string, number>;
};

type ClientSample = {
  route?: string;
  fps?: number;
  memoryMb?: number;
  heapLimitMb?: number;
  navigationMs?: number;
  firstPaintMs?: number;
  firstContentfulPaintMs?: number;
  largestContentfulPaintMs?: number;
  cumulativeLayoutShift?: number;
  longTaskCount?: number;
  longTaskMs?: number;
  resourceCount?: number;
  apiAvgMs?: number;
  apiP95Ms?: number;
  reportedAt?: string;
  userAgent?: string;
};

const startedAt = Date.now();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

const endpointStats = new Map<string, EndpointStat>();
const clientSamples: ClientSample[] = [];
let previousCpu = process.cpuUsage();
let previousHr = process.hrtime.bigint();
let lastCpuPercent = 0;

function safePath(url: string) {
  const [pathname] = url.split("?");
  return pathname.replace(/\/[a-f0-9-]{16,}/gi, "/:id").replace(/\/\d+/g, "/:id");
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value: number, places = 2) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function bytesToMb(value: number) {
  return round(value / 1024 / 1024, 1);
}

function sampleCpuPercent() {
  const nowCpu = process.cpuUsage();
  const nowHr = process.hrtime.bigint();
  const cpuMicros = (nowCpu.user - previousCpu.user) + (nowCpu.system - previousCpu.system);
  const elapsedMicros = Number(nowHr - previousHr) / 1000;
  previousCpu = nowCpu;
  previousHr = nowHr;
  if (elapsedMicros > 0) lastCpuPercent = round((cpuMicros / elapsedMicros) * 100, 1);
  return lastCpuPercent;
}

export function recordRequestMetric(method: string, url: string, statusCode: number, durationMs: number) {
  const path = safePath(url);
  const key = `${method.toUpperCase()} ${path}`;
  const current = endpointStats.get(key) ?? {
    method: method.toUpperCase(),
    path,
    count: 0,
    errors: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    durations: [],
    statusCodes: {},
  };
  current.count += 1;
  current.errors += statusCode >= 500 ? 1 : 0;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.lastMs = durationMs;
  current.durations.push(durationMs);
  if (current.durations.length > 240) current.durations.splice(0, current.durations.length - 240);
  current.statusCodes[String(statusCode)] = (current.statusCodes[String(statusCode)] ?? 0) + 1;
  endpointStats.set(key, current);
}

export function addClientPerformanceSample(sample: ClientSample, userAgent?: string) {
  clientSamples.push({
    ...sample,
    route: sample.route ?? "unknown",
    reportedAt: new Date().toISOString(),
    userAgent,
  });
  if (clientSamples.length > 80) clientSamples.splice(0, clientSamples.length - 80);
}

function endpointSnapshot() {
  return [...endpointStats.values()]
    .map((entry) => ({
      method: entry.method,
      path: entry.path,
      count: entry.count,
      errors: entry.errors,
      errorRate: round(entry.count ? (entry.errors / entry.count) * 100 : 0, 1),
      avgMs: round(entry.totalMs / Math.max(1, entry.count), 1),
      p95Ms: round(percentile(entry.durations, 95), 1),
      maxMs: round(entry.maxMs, 1),
      lastMs: round(entry.lastMs, 1),
      statusCodes: entry.statusCodes,
    }))
    .sort((left, right) => right.p95Ms - left.p95Ms || right.count - left.count);
}

function clientRouteSnapshot() {
  const byRoute = new Map<string, ClientSample[]>();
  for (const sample of clientSamples) {
    const route = sample.route ?? "unknown";
    byRoute.set(route, [...(byRoute.get(route) ?? []), sample]);
  }
  return [...byRoute.entries()].map(([route, samples]) => {
    const latest = samples[samples.length - 1] ?? {};
    const fpsValues = samples.map((item) => item.fps ?? 0).filter(Boolean);
    const apiValues = samples.map((item) => item.apiAvgMs ?? 0).filter(Boolean);
    return {
      route,
      samples: samples.length,
      latest,
      avgFps: round(fpsValues.reduce((sum, value) => sum + value, 0) / Math.max(1, fpsValues.length), 1),
      avgApiMs: round(apiValues.reduce((sum, value) => sum + value, 0) / Math.max(1, apiValues.length), 1),
    };
  }).sort((left, right) => right.samples - left.samples);
}

export function getPerformanceSnapshot() {
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const api = endpointSnapshot();
  const totalRequests = api.reduce((sum, item) => sum + item.count, 0);
  const totalErrors = api.reduce((sum, item) => sum + item.errors, 0);
  const allDurations = [...endpointStats.values()].flatMap((item) => item.durations);

  return {
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      uptimeSec: round((Date.now() - startedAt) / 1000, 1),
      process: {
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        cpuPercent: sampleCpuPercent(),
        memory: {
          rssMb: bytesToMb(memory.rss),
          heapUsedMb: bytesToMb(memory.heapUsed),
          heapTotalMb: bytesToMb(memory.heapTotal),
          externalMb: bytesToMb(memory.external),
        },
      },
      system: {
        cpus: os.cpus().length,
        loadAverage: os.loadavg().map((value) => round(value, 2)),
        memory: {
          totalMb: bytesToMb(totalMemory),
          freeMb: bytesToMb(freeMemory),
          usedPercent: round(((totalMemory - freeMemory) / totalMemory) * 100, 1),
        },
      },
      eventLoop: {
        meanMs: round(eventLoop.mean / 1e6, 2),
        maxMs: round(eventLoop.max / 1e6, 2),
        p95Ms: round(eventLoop.percentile(95) / 1e6, 2),
      },
      api: {
        totalRequests,
        totalErrors,
        errorRate: round(totalRequests ? (totalErrors / totalRequests) * 100 : 0, 1),
        avgMs: round(allDurations.reduce((sum, value) => sum + value, 0) / Math.max(1, allDurations.length), 1),
        p95Ms: round(percentile(allDurations, 95), 1),
        endpoints: api.slice(0, 18),
      },
      client: {
        samples: clientSamples.slice(-20).reverse(),
        routes: clientRouteSnapshot(),
      },
    },
  };
}
