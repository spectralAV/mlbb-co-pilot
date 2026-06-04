export type DraftSlotGroup = "allyPicks" | "enemyPicks" | "allyBans" | "enemyBans";

export type DraftSlotFact = {
  heroId?: number;
  heroName?: string;
  slot?: number;
  confidence: number;
  variant?: "normal" | "mirror-x";
  source?: string;
};

type Vote = {
  identity: string;
  fact: DraftSlotFact;
};

type SlotMemory = {
  votes: Vote[];
  locked: DraftSlotFact | null;
  stable: DraftSlotFact | null;
  contradictionVotes: number;
  lastSeenAt: number;
};

const windowSize = 5;
const stableVotes = 2;
const highConfidenceLock = 0.85;
const pickUnlockVotes = 3;
const banUnlockVotes = 3;
const pickStaleMs = 2500;

const memories = new Map<string, SlotMemory>();

export function resetDraftSlotStabilizer() {
  memories.clear();
}

export function stabilizeDraftSlotGroup(group: DraftSlotGroup, facts: DraftSlotFact[], now = Date.now()) {
  const updated = new Set<string>();
  const output = new Map<string, DraftSlotFact>();
  const retainStalePicks = group.includes("Picks");

  for (const fact of facts) {
    const key = slotKey(group, fact);
    updated.add(key);
    const stable = updateSlotMemory(key, fact, group, now);
    if (stable) output.set(key, stable);
  }

  for (const [key, memory] of memories) {
    if (!key.startsWith(`${group}:`) || updated.has(key)) continue;
    // Missed bans stay empty; do not resurrect a hero from an older frame.
    if (!retainStalePicks) continue;
    // Live draft frames are snapshots: if this frame scanned picks, omit slots with no read.
    if (facts.length > 0) continue;
    if (now - memory.lastSeenAt > pickStaleMs) continue;
    const stable = memory.locked ?? memory.stable;
    if (stable) output.set(key, stable);
  }

  const sorted = [...output.values()].sort((left, right) => Number(left.slot ?? 99) - Number(right.slot ?? 99));
  return group.includes("Picks") ? reconcileDuplicateHeroSlots(group, sorted, updated) : sorted;
}

function updateSlotMemory(key: string, fact: DraftSlotFact, group: DraftSlotGroup, now: number) {
  const unlockVotes = group.includes("Picks") ? pickUnlockVotes : banUnlockVotes;
  const memory = memories.get(key) ?? { votes: [], locked: null, stable: null, contradictionVotes: 0, lastSeenAt: now };
  const identity = factIdentity(fact);
  memory.lastSeenAt = now;
  memory.votes = [...memory.votes, { identity, fact }].slice(-windowSize);

  if (memory.locked) {
    const lockedIdentity = factIdentity(memory.locked);
    if (identity !== lockedIdentity) {
      memory.contradictionVotes += 1;
      if (memory.contradictionVotes < unlockVotes) {
        memories.set(key, memory);
        return memory.locked;
      }
      memory.locked = null;
      memory.stable = null;
      memory.contradictionVotes = 0;
      memory.votes = [{ identity, fact }];
      memories.set(key, memory);
      return fact;
    } else {
      memory.contradictionVotes = 0;
      if (fact.confidence >= memory.locked.confidence) memory.locked = fact;
      memory.stable = memory.locked;
      memories.set(key, memory);
      return memory.locked;
    }
  }

  if (fact.confidence >= highConfidenceLock) {
    memory.locked = fact;
    memory.stable = fact;
    memories.set(key, memory);
    return fact;
  }

  const stable = majorityFact(memory.votes);
  if (stable) memory.stable = stable;
  memories.set(key, memory);
  return stable ?? null;
}

/** Pre-lock hero swaps can leave the same hero on two slots briefly; prefer this frame's read over stale memory. */
export function reconcileDuplicateHeroSlots(
  group: DraftSlotGroup,
  facts: DraftSlotFact[],
  updatedKeys: Set<string>,
) {
  const winners = new Map<string, DraftSlotFact>();
  for (const fact of facts) {
    const identity = factIdentity(fact);
    const key = slotKey(group, fact);
    const previous = winners.get(identity);
    if (!previous) {
      winners.set(identity, fact);
      continue;
    }
    const previousKey = slotKey(group, previous);
    const previousFresh = updatedKeys.has(previousKey);
    const nextFresh = updatedKeys.has(key);
    if (nextFresh && !previousFresh) {
      winners.set(identity, fact);
      continue;
    }
    if (!nextFresh && previousFresh) continue;
    if (fact.confidence > previous.confidence) winners.set(identity, fact);
  }
  return [...winners.values()].sort((left, right) => Number(left.slot ?? 99) - Number(right.slot ?? 99));
}

function majorityFact(votes: Vote[]) {
  const counts = new Map<string, { count: number; best: DraftSlotFact }>();
  for (const vote of votes) {
    const current = counts.get(vote.identity);
    if (!current) {
      counts.set(vote.identity, { count: 1, best: vote.fact });
      continue;
    }
    current.count += 1;
    if (vote.fact.confidence > current.best.confidence) current.best = vote.fact;
  }
  const [winner] = [...counts.values()].sort((left, right) => right.count - left.count || right.best.confidence - left.best.confidence);
  if (!winner || winner.count < stableVotes || winner.count / votes.length < 0.5) return null;
  return winner.best;
}

function slotKey(group: DraftSlotGroup, fact: DraftSlotFact) {
  return `${group}:${Number.isInteger(fact.slot) ? fact.slot : factIdentity(fact)}`;
}

function factIdentity(fact: DraftSlotFact) {
  return fact.heroId !== undefined ? `id:${fact.heroId}` : `name:${String(fact.heroName ?? "").toLowerCase()}`;
}
