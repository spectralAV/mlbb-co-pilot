export function suggestBans(state: any, enemies: any[]) {
  const requested = [...(state.bans ?? []), ...(state.enemyBans ?? []), ...(state.allyBans ?? [])].map(String);
  const suggestions = requested.map((hero) => ({ hero, reason: "Already removed from the draft pool" }));
  if (!requested.some((name) => name.toLowerCase() === "diggie")) {
    suggestions.push({ hero: "Diggie", reason: "Denies engage and crowd-control strategies" });
  }
  if (enemies.some((enemy) => String(enemy?.name ?? "").toLowerCase() === "fanny")) {
    suggestions.push({ hero: "Khufra", reason: "Helps limit high-mobility assassins" });
  }
  return suggestions.slice(0, 4);
}
