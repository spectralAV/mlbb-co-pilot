import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Cpu, Database, MonitorSmartphone, Radio, RefreshCw, Settings2, ShieldCheck, Sparkles, XCircle, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { getSetupStatus } from "../api/client";

type SetupState = "ready" | "action" | "optional" | "error";
type SetupCheck = {
  id: string;
  label: string;
  group: "core" | "capture" | "vision" | "desktop";
  state: SetupState;
  summary: string;
  detail: string;
  action?: string;
  optional?: boolean;
};

const reviewedKey = "mlbb.setup.reviewed.v1";

const groupLabels: Record<SetupCheck["group"], string> = {
  core: "Core Runtime",
  capture: "Capture Stack",
  vision: "Vision Models",
  desktop: "Desktop Shell",
};

const groupIcons: Record<SetupCheck["group"], LucideIcon> = {
  core: Database,
  capture: MonitorSmartphone,
  vision: Cpu,
  desktop: Settings2,
};

const stateCopy: Record<SetupState, { icon: LucideIcon; classes: string }> = {
  ready: { icon: CheckCircle2, classes: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" },
  action: { icon: AlertTriangle, classes: "border-amber-300/25 bg-amber-400/10 text-amber-100" },
  optional: { icon: Radio, classes: "border-slate-300/15 bg-white/[0.04] text-slate-200" },
  error: { icon: XCircle, classes: "border-rose-300/25 bg-rose-400/10 text-rose-100" },
};

function loadReviewed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(reviewedKey) === "1";
}

export function Setup() {
  const setup = useQuery({ queryKey: ["setup-status"], queryFn: getSetupStatus, refetchInterval: 12_000 });
  const [reviewed, setReviewed] = useState(loadReviewed);
  const checks = (setup.data?.checks ?? []) as SetupCheck[];
  const readiness = setup.data?.readiness;
  const launchReady = Boolean(readiness?.launchReady);
  const requiredText = readiness ? `${readiness.requiredReady}/${readiness.requiredTotal}` : "-";
  const optionalText = readiness ? `${readiness.optionalReady}/${readiness.optionalTotal}` : "-";
  const groups = useMemo(() => {
    return (["core", "capture", "vision", "desktop"] as const).map((group) => ({
      group,
      checks: checks.filter((check) => check.group === group),
    })).filter((item) => item.checks.length);
  }, [checks]);

  useEffect(() => {
    if (!launchReady || reviewed || typeof window === "undefined") return;
    window.localStorage.setItem(reviewedKey, "1");
    setReviewed(true);
  }, [launchReady, reviewed]);

  function markReviewed() {
    window.localStorage.setItem(reviewedKey, "1");
    setReviewed(true);
  }

  return <div className="space-y-5">
    <header className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
      <div>
        <h2>First Run Setup</h2>
        <p className="mt-3 max-w-3xl text-base text-slate-400">Check the desktop alpha essentials before a real match: runtime data, capture readiness, CV model status, and optional stream integrations.</p>
      </div>
      <div className={`card p-5 ${launchReady ? "border-emerald-300/20" : "border-amber-300/20"}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase text-slate-500">v0.5 Setup Gate</div>
            <div className="mt-2 text-2xl font-black text-white">{launchReady ? "Ready" : "Needs Setup"}</div>
          </div>
          <ShieldCheck className={launchReady ? "text-emerald-200" : "text-amber-200"} size={34} />
        </div>
        <p className="mt-3 text-sm text-slate-400">{readiness?.summary ?? "Checking setup status."}</p>
      </div>
    </header>

    <section className="grid gap-3 md:grid-cols-3">
      <SetupMetric label="Required Ready" value={requiredText} detail="Backend, runtime, CV, ADB, and scrcpy readiness" />
      <SetupMetric label="Optional Ready" value={optionalText} detail="OBS, NDI, OCR, and desktop shell extras" />
      <SetupMetric label="Mode" value={setup.data?.environment?.electronManaged ? "Desktop" : "Browser"} detail={`${setup.data?.environment?.platform ?? "unknown"} / ${setup.data?.environment?.arch ?? "-"}`} />
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {setup.isLoading && <div className="card p-5 text-sm text-slate-400">Checking local setup...</div>}
        {setup.isError && <div className="card border-rose-300/20 p-5 text-sm text-rose-100">Setup status failed: {setup.error instanceof Error ? setup.error.message : "Unknown error"}</div>}
        {groups.map(({ group, checks }) => {
          const Icon = groupIcons[group];
          return <div className="card overflow-hidden" key={group}>
            <div className="flex items-center gap-3 border-b border-white/10 p-5">
              <div className="grid h-10 w-10 place-items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 text-cyan-100"><Icon size={18} /></div>
              <div>
                <h3 className="text-lg font-black text-white">{groupLabels[group]}</h3>
                <p className="mt-1 text-sm text-slate-400">{checks.length} setup checks</p>
              </div>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {checks.map((check) => <div key={check.id}><SetupCheckCard check={check} /></div>)}
            </div>
          </div>;
        })}
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <Sparkles className="text-cyan-100" />
            <h3 className="font-black text-white">Recommended Path</h3>
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <Step done={Boolean(checks.find((check) => check.id === "runtime" && check.state === "ready"))} text="Sync and compile runtime data." />
            <Step done={Boolean(checks.find((check) => check.id === "ultralytics" && check.state === "ready"))} text="Confirm YOLO model status." />
            <Step done={Boolean(checks.find((check) => check.id === "adb" && check.state === "ready"))} text="Authorize phone over ADB." />
            <Step done={Boolean(checks.find((check) => check.id === "scrcpy" && check.state === "ready"))} text="Start Backend scrcpy capture." />
          </div>
        </div>
        <div className="card p-5">
          <h3 className="font-black text-white">Shortcuts</h3>
          <div className="mt-4 grid gap-2">
            <Link className="capture-secondary-button" to="/settings?tab=data-sync">Data Sync</Link>
            <Link className="capture-secondary-button" to="/capture">Live Capture</Link>
            <Link className="capture-secondary-button" to="/calibration">Screen Setup</Link>
            <Link className="capture-secondary-button" to="/settings?tab=runtime-status">Runtime Status</Link>
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs font-black uppercase text-slate-500">Reviewed</div>
          <div className="mt-2 text-2xl font-black text-white">{reviewed ? "Yes" : "Not yet"}</div>
          <button className="btn mt-4 flex w-full items-center justify-center gap-2" onClick={markReviewed}>
            <CheckCircle2 size={18} /> Mark Reviewed
          </button>
          <button className="capture-secondary-button mt-2 w-full" onClick={() => setup.refetch()} disabled={setup.isFetching}>
            <RefreshCw size={16} /> {setup.isFetching ? "Refreshing" : "Refresh Checks"}
          </button>
        </div>
      </aside>
    </section>
  </div>;
}

function SetupMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="card p-5">
    <div className="text-xs font-black uppercase text-slate-500">{label}</div>
    <div className="mt-3 text-3xl font-black text-white">{value}</div>
    <div className="mt-2 text-sm text-slate-400">{detail}</div>
  </div>;
}

function SetupCheckCard({ check }: { check: SetupCheck }) {
  const copy = stateCopy[check.state];
  const Icon = copy.icon;
  return <div className={`rounded-lg border p-4 ${copy.classes}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-black text-white">{check.label}</div>
        <div className="mt-1 text-sm font-bold">{check.summary}</div>
      </div>
      <Icon className="shrink-0" size={22} />
    </div>
    <p className="mt-3 text-sm leading-relaxed text-slate-300">{check.detail}</p>
    {check.action && <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-200">{check.action}</div>}
  </div>;
}

function Step({ done, text }: { done: boolean; text: string }) {
  return <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3">
    {done ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-200" size={18} /> : <AlertTriangle className="mt-0.5 shrink-0 text-amber-200" size={18} />}
    <span>{text}</span>
  </div>;
}
