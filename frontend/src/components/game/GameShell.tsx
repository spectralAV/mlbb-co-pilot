import type { ReactNode } from "react";
import { riskTone, type Risk } from "../../lib/gameTypes";

export function RiskBadge({ children, risk = "low" }: { children: ReactNode; risk?: Risk }) {
  return <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-semibold uppercase ${riskTone(risk)}`}>{children}</span>;
}

export function GamePanel({ title, icon: Icon, children, className = "" }: { title: string; icon?: any; children: ReactNode; className?: string }) {
  return <section className={`card overflow-hidden ${className}`}>
    <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
      {Icon && <Icon className="h-4 w-4 text-cyan-300" />}
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-100">{title}</h3>
    </div>
    <div className="p-4">{children}</div>
  </section>;
}
