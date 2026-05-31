import type { ReactNode } from "react";
import { riskTone, type Risk } from "../../lib/gameTypes";

export function RiskBadge({ children, risk = "low", className = "" }: { children: ReactNode; risk?: Risk; className?: string }) {
  const normalized = risk.toLowerCase() as Risk;
  return <span className={`risk-badge risk-badge-${normalized} ${riskTone(risk)} ${className}`}>{children}</span>;
}

export function GamePanel({
  title,
  icon: Icon,
  children,
  className = "",
  bodyClassName = "",
  actions
}: {
  title: string;
  icon?: any;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  actions?: ReactNode;
}) {
  return <section className={`card game-panel overflow-hidden ${className}`}>
    <div className="game-panel-head">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className="h-4 w-4 flex-none text-cyan-300" />}
        <h3 className="text-sm font-bold uppercase leading-tight text-slate-100">{title}</h3>
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </div>
    <div className={`game-panel-body ${bodyClassName}`}>{children}</div>
  </section>;
}
