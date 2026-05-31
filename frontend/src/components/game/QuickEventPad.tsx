import { Radio } from "lucide-react";
import type { GameEvent, GameState, MapZoneId } from "../../lib/gameTypes";
import { formatMatchTime } from "../../lib/gameTypes";
import { GamePanel } from "./GameShell";

const events: Array<{ label: string; type: GameEvent["type"]; zone?: MapZoneId }> = [
  { label: "Enemy Jungler Top", type: "enemy_seen", zone: "river_exp" },
  { label: "Enemy Jungler Bot", type: "enemy_seen", zone: "river_gold" },
  { label: "Roam Missing", type: "enemy_missing" },
  { label: "Mid Missing", type: "enemy_missing" },
  { label: "Gold No Flicker", type: "summoner_spell_down", zone: "gold_lane" },
  { label: "EXP No Ult", type: "ultimate_down", zone: "exp_lane" },
  { label: "Won Fight", type: "fight_won" },
  { label: "Lost Fight", type: "fight_lost" },
  { label: "Turtle Taken", type: "objective_taken", zone: "objective_pit" },
  { label: "Lord Taken", type: "objective_taken", zone: "objective_pit" },
  { label: "Reset / Recall", type: "rotation", zone: "ally_base" },
  { label: "I Died", type: "death" },
  { label: "Enemy Jungler Dead", type: "custom" },
  { label: "Enemy Marksman Dead", type: "custom" }
];

export function QuickEventPad({ state, onEvent }: { state: GameState; onEvent: (event: GameEvent) => void }) {
  return <GamePanel title="Quick Events" icon={Radio}>
    <div className="quick-event-grid">
      {events.map((event) => <button key={event.label} className="quick-event-button" onClick={() => onEvent({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        matchTime: formatMatchTime(state.matchTimeSeconds),
        type: event.type,
        label: event.label,
        zone: event.zone,
        source: "manual",
        confidence: "high"
      })}>{event.label}</button>)}
    </div>
  </GamePanel>;
}
