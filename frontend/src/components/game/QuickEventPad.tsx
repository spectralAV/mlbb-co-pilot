import { Radio } from "lucide-react";
import type { GameEvent, GameState, MapZoneId } from "../../lib/gameTypes";
import { formatMatchTime } from "../../lib/gameTypes";
import { GamePanel } from "./GameShell";

const events: Array<{ label: string; type: GameEvent["type"]; zone?: MapZoneId }> = [
  { label: "Enemy Jungler Seen Top", type: "enemy_seen", zone: "exp_lane" },
  { label: "Enemy Jungler Seen Bot", type: "enemy_seen", zone: "gold_lane" },
  { label: "Enemy Roam Missing", type: "enemy_missing" },
  { label: "Enemy Mid Missing", type: "enemy_missing" },
  { label: "Gold No Flicker", type: "summoner_spell_down", zone: "gold_lane" },
  { label: "EXP No Ult", type: "ultimate_down", zone: "exp_lane" },
  { label: "We Won Fight", type: "fight_won" },
  { label: "We Lost Fight", type: "fight_lost" },
  { label: "Turtle Taken", type: "objective_taken", zone: "objective_pit" },
  { label: "Lord Taken", type: "objective_taken", zone: "objective_pit" },
  { label: "Reset / Recall", type: "rotation", zone: "ally_base" },
  { label: "I Died", type: "death" },
  { label: "Enemy Jungler Dead", type: "custom" },
  { label: "Enemy Marksman Dead", type: "custom" }
];

export function QuickEventPad({ state, onEvent }: { state: GameState; onEvent: (event: GameEvent) => void }) {
  return <GamePanel title="Quick Events" icon={Radio}>
    <div className="grid grid-cols-2 gap-2">
      {events.map((event) => <button key={event.label} className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-left text-xs font-semibold text-slate-200 transition hover:bg-white/10" onClick={() => onEvent({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        matchTime: formatMatchTime(state.matchTimeSeconds),
        type: event.type,
        label: event.label,
        zone: event.zone,
        confidence: "high"
      })}>{event.label}</button>)}
    </div>
  </GamePanel>;
}
