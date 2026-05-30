import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, Gauge, HardDrive, RefreshCw, Server, Timer, Zap } from "lucide-react";
import { getPerformanceSnapshot } from "../api/client";

type PerfData = {
  generatedAt: string;
  uptimeSec: number;
  process: {
    pid: number;
    node: string;
    platform: string;
    cpuPercent: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
  };
  system: {
    cpus: number;
    loadAverage: number[];
    memory: { totalMb: number; freeMb: number; usedPercent: number };
  };
  eventLoop: { meanMs: number; maxMs: number; p95Ms: number };
  api: {
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
    avgMs: number;
    p95Ms: number;
    endpoints: Array<{
      method: string;
      path: string;
      count: number;
      errors: number;
      errorRate: number;
      avgMs: number;
      p95Ms: number;
      maxMs: number;
      lastMs: number;
      statusCodes: Record<string, number>;
    }>;
  };
  client: {
    samples: Array<any>;
    routes: Array<{ route: string; samples: number; avgFps: number; avgApiMs: number; latest: any }>;
  };
};

export function PerformanceMonitor() {
  const [live, setLive] = useState(true);
  const query = useQuery({
    queryKey: ["performance-snapshot"],
    queryFn: getPerformanceSnapshot,
    refetchInterval: live ? 2500 : false,
  });
  const data = query.data?.data as PerfData | undefined;
  const health = useMemo(() => getHealth(data), [data]);

  return <div className="performance-page">
    <header className="performance-hero">
      <div>
        <h2>Performance</h2>
        <p className="mt-4 max-w-2xl text-base text-slate-400">Live backend, API, event-loop, and browser telemetry for MLBB Co-Pilot.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={`perf-live-toggle ${live ? "perf-live-toggle-on" : ""}`} onClick={() => setLive((value) => !value)}>
          <span className="h-2 w-2 rounded-full bg-current" />{live ? "Live" : "Paused"}
        </button>
        <button className="cv-ghost-button inline-flex items-center gap-2" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={15} />Refresh
        </button>
      </div>
    </header>

    <section className="perf-health-band">
      <div>
        <div className="cv-rail-label">System Health</div>
        <div className={`perf-health-title ${health.tone}`}>{health.label}</div>
      </div>
      <div className="perf-health-gauge" style={gaugeStyle(health.score)}>
        <span>{Math.round(health.score)}</span>
      </div>
      <div className="perf-health-meter">
        <span style={{ width: `${health.score}%` }} />
      </div>
      <div className="text-right text-sm text-slate-400">
        <div>{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : "Waiting for metrics"}</div>
        <div>{data ? `Uptime ${formatDuration(data.uptimeSec)}` : query.isError ? "Backend unavailable" : "Collecting"}</div>
      </div>
    </section>

    <section className="perf-metric-grid">
      <PerfMetric icon={<Cpu />} label="Process CPU" value={formatPercent(data?.process.cpuPercent)} detail={`${data?.system.cpus ?? 0} cores`} meter={data?.process.cpuPercent ?? 0} />
      <PerfMetric icon={<HardDrive />} label="RSS Memory" value={`${data?.process.memory.rssMb ?? "--"} MB`} detail={`Heap ${data?.process.memory.heapUsedMb ?? "--"} / ${data?.process.memory.heapTotalMb ?? "--"} MB`} meter={data ? Math.min(100, (data.process.memory.heapUsedMb / Math.max(1, data.process.memory.heapTotalMb)) * 100) : 0} />
      <PerfMetric icon={<Server />} label="System Memory" value={formatPercent(data?.system.memory.usedPercent)} detail={`${data?.system.memory.freeMb ?? "--"} MB free`} meter={data?.system.memory.usedPercent ?? 0} />
      <PerfMetric icon={<Timer />} label="Event Loop P95" value={`${data?.eventLoop.p95Ms ?? "--"} ms`} detail={`Max ${data?.eventLoop.maxMs ?? "--"} ms`} meter={clamp((data?.eventLoop.p95Ms ?? 0) * 3, 0, 100)} />
      <PerfMetric icon={<Gauge />} label="API P95" value={`${data?.api.p95Ms ?? "--"} ms`} detail={`${data?.api.totalRequests ?? 0} requests`} meter={clamp((data?.api.p95Ms ?? 0) / 4, 0, 100)} />
      <PerfMetric icon={<Zap />} label="API Error Rate" value={formatPercent(data?.api.errorRate)} detail={`${data?.api.totalErrors ?? 0} server errors`} meter={data?.api.errorRate ?? 0} danger />
    </section>

    <div className="perf-workspace">
      <section className="perf-panel">
        <div className="perf-panel-head">
          <h3>Endpoint Latency</h3>
          <span>{data?.api.endpoints.length ?? 0} tracked</span>
        </div>
        <div className="perf-table">
          <div className="perf-table-row perf-table-head-row">
            <span>Route</span><span>Count</span><span>Avg</span><span>P95</span><span>Errors</span>
          </div>
          {data?.api.endpoints.length ? data.api.endpoints.map((endpoint) => <div key={`${endpoint.method}-${endpoint.path}`} className="perf-table-row">
            <span className="min-w-0 truncate"><b>{endpoint.method}</b> {endpoint.path}</span>
            <span>{endpoint.count}</span>
            <span>{endpoint.avgMs} ms</span>
            <span className={endpoint.p95Ms > 250 ? "text-amber-200" : "text-cyan-100"}>{endpoint.p95Ms} ms</span>
            <span className={endpoint.errors ? "text-rose-200" : "text-slate-400"}>{endpoint.errors}</span>
          </div>) : <div className="p-4 text-sm text-slate-400">No API requests have been observed yet.</div>}
        </div>
      </section>

      <section className="perf-panel">
        <div className="perf-panel-head">
          <h3>Browser Routes</h3>
          <span>{data?.client.routes.length ?? 0} routes</span>
        </div>
        <div className="space-y-2 p-3">
          {data?.client.routes.length ? data.client.routes.map((route) => <div key={route.route} className="perf-route-card">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">{route.route}</div>
              <div className="mt-1 text-xs text-slate-500">{route.samples} samples / API avg {route.avgApiMs} ms</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-black text-cyan-100">{route.avgFps || "--"}</div>
              <div className="text-[10px] font-bold uppercase text-slate-500">FPS</div>
            </div>
          </div>) : <div className="rounded border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">Open any app screen for a few seconds to collect browser telemetry.</div>}
        </div>
      </section>
    </div>

    <section className="perf-panel">
      <div className="perf-panel-head">
        <h3>Recent Browser Samples</h3>
        <span>{data?.client.samples.length ?? 0} latest</span>
      </div>
      <div className="perf-sample-grid">
        {data?.client.samples.length ? data.client.samples.slice(0, 8).map((sample, index) => <div key={`${sample.reportedAt}-${index}`} className="perf-sample-card">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-bold text-white">{sample.route ?? "unknown"}</span>
            <span className="text-xs text-slate-500">{sample.reportedAt ? new Date(sample.reportedAt).toLocaleTimeString() : "--"}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <SampleValue label="FPS" value={sample.fps} />
            <SampleValue label="Heap" value={sample.memoryMb ? `${sample.memoryMb} MB` : "--"} />
            <SampleValue label="API P95" value={sample.apiP95Ms ? `${sample.apiP95Ms} ms` : "--"} />
            <SampleValue label="LCP" value={sample.largestContentfulPaintMs ? `${sample.largestContentfulPaintMs} ms` : "--"} />
            <SampleValue label="CLS" value={sample.cumulativeLayoutShift ?? "--"} />
            <SampleValue label="Long tasks" value={sample.longTaskCount ?? 0} />
          </div>
        </div>) : <div className="p-4 text-sm text-slate-400">Browser samples will appear after telemetry posts its first report.</div>}
      </div>
    </section>
  </div>;
}

function PerfMetric({ icon, label, value, detail, meter, danger }: { icon: ReactNode; label: string; value: string; detail: string; meter: number; danger?: boolean }) {
  const safeMeter = clamp(meter, 0, 100);
  return <div className="perf-metric">
    <div className="perf-metric-gauge" style={gaugeStyle(safeMeter, danger)}>
      <div className={danger ? "text-rose-200" : "text-cyan-300"}>{icon}</div>
      <span>{Math.round(safeMeter)}</span>
    </div>
    <div className="min-w-0 flex-1">
      <div className="cv-rail-label">{label}</div>
      <div className="mt-1 truncate text-xl font-black text-white">{value}</div>
      <div className="mt-1 truncate text-xs text-slate-500">{detail}</div>
      <div className={`perf-mini-meter ${danger ? "perf-mini-meter-danger" : ""}`}><span style={{ width: `${safeMeter}%` }} /></div>
    </div>
  </div>;
}

function gaugeStyle(value: number, danger?: boolean) {
  const safe = clamp(value, 0, 100);
  const color = danger ? "#fb7185" : "var(--mlbb-cyan)";
  return { background: `conic-gradient(${color} ${safe * 3.6}deg, rgba(255,255,255,.08) 0deg)` };
}

function SampleValue({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded border border-white/10 bg-black/20 p-2">
    <div className="text-[10px] font-black uppercase text-slate-500">{label}</div>
    <div className="mt-1 truncate font-bold text-slate-100">{value}</div>
  </div>;
}

function getHealth(data?: PerfData) {
  if (!data) return { label: "Collecting", score: 25, tone: "text-slate-200" };
  const penalties = [
    Math.min(35, data.api.errorRate * 6),
    Math.min(25, data.api.p95Ms / 18),
    Math.min(20, data.eventLoop.p95Ms * 1.5),
    Math.min(20, data.system.memory.usedPercent / 5),
    Math.min(15, data.process.cpuPercent / 4),
  ];
  const score = clamp(100 - penalties.reduce((sum, value) => sum + value, 0), 0, 100);
  if (score >= 78) return { label: "Nominal", score, tone: "text-cyan-100" };
  if (score >= 52) return { label: "Watch", score, tone: "text-amber-100" };
  return { label: "Hot", score, tone: "text-rose-100" };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value?: number) {
  return value == null ? "--" : `${value}%`;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
