import { useEffect, useMemo, useState } from "react";
import { KeyRound, LogOut, RefreshCw, Send, ShieldCheck, Swords, Trophy, UserRound } from "lucide-react";
import { deleteRoneSnapshot, getRonePublic, getRoneSnapshot, getRoneStatus, getRoneUser, loginRoneUser, postRoneUser, saveRoneSnapshot, sendRoneVerificationCode } from "../../api/client";

const sessionTokenKey = "mlbb-copilot.rone.jwt";
const catalogCacheKey = "mlbb-copilot.rone.catalog";

type Snapshot = {
  info?: any;
  stats?: any;
  seasons?: any;
  ranks?: any;
  matches?: any;
  frequentHeroes?: any;
  overallFrequentHeroes?: any;
  friends?: any;
};

function numberInput(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function payloadItems(payload: any) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.list)) return data.list;
  return [];
}

function payloadCount(payload: any) {
  const data = payload?.data;
  if (typeof data?.total === "number") return data.total;
  if (typeof data?.pageInfo?.count === "number") return data.pageInfo.count;
  if (Array.isArray(data?.sids)) return data.sids.length;
  const items = payloadItems(payload);
  if (items.length) return items.length;
  return payload ? 1 : 0;
}

function latestGameVersion(payload: any) {
  const records = payload?.data?.records;
  const first = Array.isArray(records) ? records[0] : null;
  return first?.data?.game_version ?? "-";
}

function readCatalogCache() {
  try {
    const raw = localStorage.getItem(catalogCacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.catalog ? parsed : null;
  } catch {
    return null;
  }
}

function writeCatalogCache(catalog: any, checkedAt: string) {
  try {
    localStorage.setItem(catalogCacheKey, JSON.stringify({ catalog, checkedAt }));
  } catch {
    // Catalog still works for the current session if persistent storage is unavailable.
  }
}

function localTime(value: string) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
  } catch {
    return value;
  }
}

function seasonIds(...payloads: any[]) {
  const ids: number[] = [];
  for (const payload of payloads) {
    const raw = payload?.data?.sids;
    if (!Array.isArray(raw)) continue;
    raw.map(Number).filter(Number.isFinite).forEach((sid) => {
      if (!ids.includes(sid)) ids.push(sid);
    });
  }
  return ids;
}

function firstSeasonId(...payloads: any[]) {
  const direct = seasonIds(...payloads);
  if (direct.length) return direct[0];
  const ids = new Set<number>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (["sid", "season_id", "seasonId", "id"].includes(key) && Number.isInteger(Number(entry))) ids.add(Number(entry));
      visit(entry);
    }
  };
  payloads.forEach(visit);
  return [...ids].sort((left, right) => right - left)[0] ?? 0;
}

function heroName(item: any) {
  const data = item?.data ?? item;
  const heroId = data?.hero_id ?? data?.hid ?? item?.hero_id ?? item?.hid;
  return item?.hid_e?.n ?? data?.hero?.data?.name ?? data?.name ?? data?.n ?? (heroId ? `Hero #${heroId}` : "Unknown hero");
}

function heroImage(item: any) {
  const data = item?.data ?? item;
  return item?.hid_e?.ix ?? item?.hid_e?.i2x ?? data?.hero?.data?.head ?? data?.avatar ?? item?.avatar ?? "";
}

function heroNames(payload: any) {
  return payloadItems(payload).map(heroName).filter(Boolean).slice(0, 8).join(", ");
}

function userName(payload: any) {
  const data = payload?.data ?? {};
  return data.name ?? data.nick_name ?? data.nickname ?? data.role_name ?? data.roleName ?? "Linked account";
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(part: unknown, total: unknown) {
  const numerator = numberValue(part);
  const denominator = numberValue(total);
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "-";
}

function score(value: unknown) {
  const parsed = numberValue(value);
  if (!parsed) return "-";
  return (parsed / 100).toFixed(1);
}

type RankRecord = {
  start: number;
  end: number;
  bigrank: number;
};

const mythicRankStart = 136;

const rankNames: Record<number, string> = {
  1: "Warrior",
  2: "Elite",
  3: "Master",
  4: "Grandmaster",
  5: "Epic",
  6: "Legend",
};

const rankRomanByStart: Record<number, string> = {
  1: "III", 5: "II", 8: "I",
  11: "III", 16: "II", 21: "I",
  26: "IV", 31: "III", 36: "II", 41: "I",
  46: "V", 52: "IV", 58: "III", 64: "II", 70: "I",
  76: "V", 82: "IV", 88: "III", 94: "II", 100: "I",
  106: "V", 112: "IV", 118: "III", 124: "II", 130: "I",
};

function rankRecords(payload: any): RankRecord[] {
  return payloadItems(payload).map((item) => item?.data ?? item).map((data) => ({
    start: Number(data?.rankid_start),
    end: Number(data?.rankid_end),
    bigrank: Number(data?.bigrank),
  })).filter((record) => Number.isFinite(record.start) && Number.isFinite(record.end));
}

function mythicName(stars: number) {
  if (stars >= 100) return "Mythical Immortal";
  if (stars >= 50) return "Mythical Glory";
  if (stars >= 25) return "Mythical Honor";
  return "Mythic";
}

function rankInfo(levelValue: unknown, ranksPayload: any) {
  const level = numberValue(levelValue);
  if (!level) return { value: "-", detail: "No rank level" };

  const record = rankRecords(ranksPayload).find((entry) => level >= entry.start && level <= entry.end);
  if (level >= mythicRankStart) {
    const stars = Math.max(0, level - mythicRankStart);
    return { value: mythicName(stars), detail: `${stars} stars / raw ${level}` };
  }

  const rankName = record ? rankNames[record.bigrank] : "";
  const roman = record ? rankRomanByStart[record.start] : "";
  const value = [rankName, roman].filter(Boolean).join(" ") || `Rank ${level}`;
  const stars = record ? Math.max(0, level - record.start) : null;
  return {
    value,
    detail: stars === null ? `Raw ${level}` : `${stars} stars / raw ${level}`,
  };
}

function localDate(seconds: unknown) {
  const parsed = numberValue(seconds);
  if (!parsed) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(parsed * 1000));
}

const laneNames: Record<number, string> = {
  1: "EXP",
  2: "Mid",
  3: "Roam",
  4: "Jungle",
  5: "Gold"
};

function SnapshotMetric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="rounded-lg bg-white/5 p-3">
    <span className="text-xs uppercase text-slate-400">{label}</span>
    <div className="mt-1 min-w-0 break-words text-sm font-semibold leading-tight text-white" title={String(value)}>{value}</div>
    {detail ? <div className="mt-1 min-w-0 break-words text-xs leading-tight text-slate-400" title={detail}>{detail}</div> : null}
  </div>;
}

function HeroAvatar({ item, className = "h-10 w-10" }: { item: any; className?: string }) {
  const image = heroImage(item);
  return image
    ? <img className={`${className} rounded-lg object-cover`} src={image} alt="" />
    : <div className={`${className} rounded-lg bg-white/10`} />;
}

export function RoneApi() {
  const cachedCatalog = useMemo(() => readCatalogCache(), []);
  const [roleId, setRoleId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [token, setToken] = useState(() => sessionStorage.getItem(sessionTokenKey) ?? "");
  const [status, setStatus] = useState<any>(null);
  const [statusCheckedAt, setStatusCheckedAt] = useState("");
  const [catalog, setCatalog] = useState<any>(() => cachedCatalog?.catalog ?? null);
  const [catalogCheckedAt, setCatalogCheckedAt] = useState(() => cachedCatalog?.checkedAt ?? "");
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [snapshotStoredAt, setSnapshotStoredAt] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"status" | "catalog" | "code" | "login" | "snapshot" | "logout" | null>(null);

  const linked = token.length > 16;
  const selectedSeason = useMemo(() => numberInput(seasonId), [seasonId]);
  const gameVersion = latestGameVersion(status?.version ?? catalog?.version);
  const info = snapshot.info?.data ?? {};
  const stats = snapshot.stats?.data ?? {};
  const seasons = seasonIds(snapshot.seasons, snapshot.stats);
  const currentRank = rankInfo(info.rank_level, snapshot.ranks ?? catalog?.ranks);
  const peakRank = rankInfo(info.history_rank_level, snapshot.ranks ?? catalog?.ranks);
  const matches = payloadItems(snapshot.matches);
  const frequentHeroes = payloadItems(snapshot.frequentHeroes);
  const overallFrequentHeroes = payloadItems(snapshot.overallFrequentHeroes);
  const friendCount = (snapshot.friends?.data?.fs?.length ?? 0) + (snapshot.friends?.data?.wfs?.length ?? 0);
  const winRate = percent(stats.wc, stats.tc);
  const statHighlights = [
    { label: "Highest Kills", item: stats.hk, value: stats.hk?.v },
    { label: "Most Assists", item: stats.ma, value: stats.ma?.v },
    { label: "Best Score", item: stats.ms, value: score(stats.ms?.v) },
    { label: "Most Gold", item: stats.mg, value: stats.mg?.v },
  ].filter((entry) => entry.item);

  async function loadStatus() {
    setBusy("status");
    try {
      const result = await getRoneStatus();
      const checkedAt = result?.checkedAt ?? new Date().toISOString();
      setStatus(result);
      setStatusCheckedAt(checkedAt);
      setMessage(`Rone status refreshed at ${localTime(checkedAt)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadCatalog() {
    setBusy("catalog");
    try {
      const [heroes, spells, equipment, ranks, version] = await Promise.all([
        getRonePublic("heroes", { size: 12, index: 1, order: "desc", lang: "en" }),
        getRonePublic("academy/spells", { lang: "en" }),
        getRonePublic("academy/equipment", { lang: "en" }),
        getRonePublic("academy/ranks", { size: 100, lang: "en" }),
        getRonePublic("academy/meta/version", { lang: "en" }),
      ]);
      const checkedAt = new Date().toISOString();
      const nextCatalog = { heroes, spells, equipment, ranks, version };
      setCatalog(nextCatalog);
      setCatalogCheckedAt(checkedAt);
      writeCatalogCache(nextCatalog, checkedAt);
      setMessage(`Rone catalog refreshed at ${localTime(checkedAt)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    setBusy("code");
    try {
      const result = await sendRoneVerificationCode(numberInput(roleId), numberInput(zoneId));
      setMessage(result?.msg ?? result?.message ?? "Verification code sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function login() {
    setBusy("login");
    try {
      const result = await loginRoneUser(numberInput(roleId), numberInput(zoneId), numberInput(verificationCode));
      const jwt = String(result?.data?.jwt ?? "");
      if (!jwt) throw new Error("Login succeeded without a JWT.");
      sessionStorage.setItem(sessionTokenKey, jwt);
      setToken(jwt);
      setMessage("Rone account linked for this session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadSavedSnapshot() {
    try {
      const saved = await getRoneSnapshot();
      const data = saved?.data;
      if (!data?.snapshot) return;
      setSnapshot(data.snapshot);
      setSnapshotStoredAt(String(data.storedAt ?? ""));
      if (data.seasonId) setSeasonId(String(data.seasonId));
    } catch {
      // The live account flow still works if no saved snapshot is available.
    }
  }

  async function loadSnapshot() {
    if (!token) return;
    setBusy("snapshot");
    try {
      const [info, stats, seasons] = await Promise.all([
        getRoneUser("info", token, { lang: "en" }),
        getRoneUser("stats", token, { lang: "en" }),
        getRoneUser("season", token, { lang: "en" }),
      ]);
      const ranks = await getRonePublic("academy/ranks", { size: 100, lang: "en" }).catch(() => catalog?.ranks ?? null);
      const nextSeason = selectedSeason || firstSeasonId(seasons, stats);
      if (!selectedSeason && nextSeason) setSeasonId(String(nextSeason));
      const [matches, frequentHeroes, overallFrequentHeroes, friends] = nextSeason ? await Promise.all([
        getRoneUser("matches", token, { sid: nextSeason, limit: 10, lang: "en" }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
        getRoneUser("heroes/frequent", token, { sid: nextSeason, limit: 12, lang: "en" }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
        getRoneUser("heroes/frequent", token, { limit: 30, lang: "en" }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
        getRoneUser("friends", token, { sid: nextSeason, lang: "en" }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
      ]) : [null, null, null, null];
      const nextSnapshot = { info, stats, seasons, ranks, matches, frequentHeroes, overallFrequentHeroes, friends };
      setSnapshot(nextSnapshot);
      const saved = await saveRoneSnapshot({ seasonId: nextSeason || undefined, snapshot: nextSnapshot });
      setSnapshotStoredAt(String(saved?.data?.storedAt ?? new Date().toISOString()));
      setMessage(nextSeason ? `Account snapshot loaded and saved for Season ${nextSeason}.` : "Account snapshot loaded and saved, but Rone did not return a season id.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    setBusy("logout");
    try {
      if (token) await postRoneUser("auth/logout", token, {});
    } catch {
      // Local unlink still clears the session token.
    } finally {
      sessionStorage.removeItem(sessionTokenKey);
      await deleteRoneSnapshot().catch(() => null);
      setToken("");
      setSnapshot({});
      setSnapshotStoredAt("");
      setBusy(null);
      setMessage("Rone account unlinked and saved snapshot cleared.");
    }
  }

  useEffect(() => {
    void loadStatus();
    void loadSavedSnapshot();
  }, []);

  return <div className="space-y-4">
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">Rone API</h3>
          <p className="text-sm text-slate-400">Public MLBB catalog plus opt-in account data.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn inline-flex items-center gap-2" disabled={busy === "status"} onClick={() => void loadStatus()}>
            <RefreshCw className={`h-4 w-4 ${busy === "status" ? "animate-spin" : ""}`} />Status
          </button>
          <button className="btn inline-flex items-center gap-2" disabled={busy === "catalog"} onClick={() => void loadCatalog()}>
            <RefreshCw className={`h-4 w-4 ${busy === "catalog" ? "animate-spin" : ""}`} />Catalog
          </button>
        </div>
      </div>
      {message && <p className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-3 text-sm text-cyan-100">{message}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <SnapshotMetric label="Provider" value={status?.ok ? "Online" : "Unchecked"} detail={status?.baseUrl ?? "Status not checked"} />
        <SnapshotMetric label="Checked" value={statusCheckedAt ? localTime(statusCheckedAt) : "-"} detail={busy === "status" ? "Refreshing status" : "Last status refresh"} />
        <SnapshotMetric label="Game Version" value={gameVersion} detail="Rone academy meta" />
        <SnapshotMetric label="User Auth" value={linked ? "Linked" : status?.userAuth ? "Ready" : "Unchecked"} detail={linked ? "Session token active" : "Verification-code flow"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        <SnapshotMetric label="Heroes" value={catalog ? payloadCount(catalog.heroes) : "-"} detail={heroNames(catalog?.heroes) || "Public catalog"} />
        <SnapshotMetric label="Spells" value={catalog ? payloadCount(catalog.spells) : "-"} />
        <SnapshotMetric label="Equipment" value={catalog ? payloadCount(catalog.equipment) : "-"} />
        <SnapshotMetric label="Ranks" value={catalog ? payloadCount(catalog.ranks) : "-"} />
        <SnapshotMetric label="Catalog" value={catalogCheckedAt ? localTime(catalogCheckedAt) : "-"} detail={busy === "catalog" ? "Refreshing catalog" : "Last catalog refresh"} />
      </div>
    </section>

    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5 text-cyan-300" />Account Link</h3>
          <p className="text-sm text-slate-400">{linked ? "Session token active." : "Use the in-game verification code flow."}</p>
        </div>
        {linked ? <button className="btn inline-flex items-center gap-2" disabled={busy === "logout"} onClick={() => void logout()}><LogOut className="h-4 w-4" />Unlink</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Game ID<input className="input mt-2 w-full" inputMode="numeric" value={roleId} onChange={(event) => setRoleId(event.target.value)} /></label>
        <label className="block text-sm">Server ID<input className="input mt-2 w-full" inputMode="numeric" value={zoneId} onChange={(event) => setZoneId(event.target.value)} /></label>
        <label className="block text-sm">Code<input className="input mt-2 w-full" inputMode="numeric" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn inline-flex items-center gap-2" disabled={busy === "code" || !roleId || !zoneId} onClick={() => void sendCode()}>
          <Send className="h-4 w-4" />{busy === "code" ? "Sending" : "Send Code"}
        </button>
        <button className="btn inline-flex items-center gap-2" disabled={busy === "login" || !roleId || !zoneId || !verificationCode} onClick={() => void login()}>
          <KeyRound className="h-4 w-4" />{busy === "login" ? "Linking" : "Link Account"}
        </button>
      </div>
    </section>

    <section className="card space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold"><UserRound className="h-5 w-5 text-cyan-300" />Account Snapshot</h3>
          <p className="text-sm text-slate-400">{snapshot.info ? `${userName(snapshot.info)} / Season ${seasonId || seasons[0] || "-"}${snapshotStoredAt ? ` / Saved ${localTime(snapshotStoredAt)}` : ""}` : linked ? "Ready to load." : "Link an account first."}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm text-slate-300">Season<input className="input mt-2 w-28" inputMode="numeric" value={seasonId} onChange={(event) => setSeasonId(event.target.value)} /></label>
          <button className="btn inline-flex items-center gap-2" disabled={!linked || busy === "snapshot"} onClick={() => void loadSnapshot()}>
            <RefreshCw className={`h-4 w-4 ${busy === "snapshot" ? "animate-spin" : ""}`} />Load
          </button>
        </div>
      </div>
      {snapshot.info ? <>
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.2fr)_minmax(360px,2fr)]">
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="flex items-center gap-4">
              {info.avatar ? <img className="h-16 w-16 rounded-xl object-cover" src={info.avatar} alt="" /> : <div className="h-16 w-16 rounded-xl bg-white/10" />}
              <div className="min-w-0">
                <div className="truncate text-xl font-black text-white">{info.name ?? userName(snapshot.info)}</div>
                <div className="mt-1 text-sm text-slate-400">ID {info.roleId ?? "-"} / {info.zoneId ?? "-"}</div>
                <div className="mt-1 text-xs uppercase text-slate-500">{info.reg_country ?? "Unknown region"}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <SnapshotMetric label="Level" value={info.level ?? "-"} />
              <SnapshotMetric label="Rank" value={currentRank.value} detail={currentRank.detail} />
              <SnapshotMetric label="Peak" value={peakRank.value} detail={peakRank.detail} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <SnapshotMetric label="Matches" value={stats.tc ?? "-"} detail={`${stats.wc ?? 0} wins`} />
            <SnapshotMetric label="Win Rate" value={winRate} detail="All returned stats" />
            <SnapshotMetric label="Avg Score" value={score(stats.as)} detail="Score / 100" />
            <SnapshotMetric label="MVPs" value={stats.mvpc ?? "-"} detail={stats.wsc ? `${stats.wsc} win streak` : "Season record"} />
            <SnapshotMetric label="Seasons" value={seasons.length || "-"} detail={seasons.slice(0, 4).join(", ")} />
            <SnapshotMetric label="Recent" value={matches.length || "-"} detail={snapshot.matches?.error ?? "Matches loaded"} />
            <SnapshotMetric label="Season Heroes" value={frequentHeroes.length || "-"} detail={snapshot.frequentHeroes?.error ?? heroNames(snapshot.frequentHeroes)} />
            <SnapshotMetric label="Overall Heroes" value={overallFrequentHeroes.length || "-"} detail={snapshot.overallFrequentHeroes?.error ?? heroNames(snapshot.overallFrequentHeroes)} />
            <SnapshotMetric label="Friends" value={friendCount || "-"} detail={snapshot.friends?.error ?? "Rone friends list"} />
          </div>
        </div>

        {statHighlights.length > 0 && <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-200"><Trophy className="h-4 w-4 text-cyan-300" />Career Highlights</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {statHighlights.map((entry) => <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3" key={entry.label}>
              <HeroAvatar item={entry.item} />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-white">{entry.label}</div>
                <div className="truncate text-xs text-slate-400">{heroName(entry.item)} / {entry.value ?? "-"}</div>
              </div>
            </div>)}
          </div>
        </div>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-200"><Swords className="h-4 w-4 text-cyan-300" />Recent Matches</div>
            <div className="space-y-2">
              {matches.length ? matches.slice(0, 8).map((match, index) => <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3" key={`${match.bid_s ?? match.bid ?? index}`}>
                <HeroAvatar item={match} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-white">{heroName(match)} <span className={match.res ? "text-emerald-300" : "text-red-300"}>{match.res ? "Win" : "Loss"}</span></div>
                  <div className="text-xs text-slate-400">{laneNames[Number(match.lid)] ?? "Lane ?"} / {match.k ?? 0}-{match.d ?? 0}-{match.a ?? 0} / {localDate(match.ts)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-white">{score(match.s)}</div>
                  <div className="text-xs text-slate-500">{match.mvp ? "MVP" : `S${match.sid ?? "-"}`}</div>
                </div>
              </div>) : <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-400">{snapshot.matches?.error ?? "No recent matches returned for this season."}</div>}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-200"><Trophy className="h-4 w-4 text-cyan-300" />Frequent Heroes</div>
            <div className="space-y-2">
              {frequentHeroes.length ? frequentHeroes.slice(0, 8).map((hero, index) => <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3" key={`${hero.hid ?? index}`}>
                <HeroAvatar item={hero} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-white">{heroName(hero)}</div>
                  <div className="text-xs text-slate-400">{hero.tc ?? 0} matches / {percent(hero.wc, hero.tc)} WR</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-white">{score(hero.bs)}</div>
                  <div className="text-xs text-slate-500">Best</div>
                </div>
              </div>) : <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-400">{snapshot.frequentHeroes?.error ?? "No frequent heroes returned for this season."}</div>}
            </div>
          </div>
        </div>

        <details className="rounded-lg border border-white/10 bg-black/20 p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-300">Raw Rone response</summary>
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-200">{JSON.stringify(snapshot, null, 2)}</pre>
        </details>
      </> : <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-400">Link an account, then load the snapshot to see playstyle, match history, and comfort heroes.</div>}
    </section>
  </div>;
}
