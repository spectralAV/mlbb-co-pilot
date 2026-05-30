import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RONE_API_BASE } from "../config.js";
import { cache } from "../services/cacheService.js";
import { getPlayerProfile, savePlayerProfile } from "../services/playerProfile.js";
import { RoneApiError, roneApi } from "../services/roneApiService.js";

const AccountSchema = z.object({
  role_id: z.coerce.number().int().positive().optional(),
  roleId: z.coerce.number().int().positive().optional(),
  zone_id: z.coerce.number().int().positive().optional(),
  zoneId: z.coerce.number().int().positive().optional()
}).passthrough();

const LoginSchema = AccountSchema.extend({
  vc: z.coerce.number().int().positive()
});

const SnapshotSchema = z.object({
  seasonId: z.coerce.number().int().positive().optional(),
  snapshot: z.any()
});

const snapshotFile = "rone-account-snapshot.json";

const PUBLIC_GET_PATTERNS = [
  /^\/api\/academy\/(?:emblems|equipment|equipment\/expanded|heroes|heroes\/catalog|heroes\/ratings|meta\/version|ranks|recommended|roles|spells)$/,
  /^\/api\/academy\/heroes\/ratings\/[^/]+$/,
  /^\/api\/academy\/heroes\/[^/]+\/(?:builds|counters|lane|recommended|stats|teammates|trends|win-rate\/timeline)$/,
  /^\/api\/academy\/ranks\/[^/]+$/,
  /^\/api\/academy\/recommended\/[^/]+$/,
  /^\/api\/heroes$/,
  /^\/api\/heroes\/(?:positions|rank)$/,
  /^\/api\/heroes\/[^/]+$/,
  /^\/api\/heroes\/[^/]+\/(?:compatibility|counters|relations|skill-combos|stats|trends)$/,
  /^\/api\/addon\/(?:ip|win-rate-calculator)$/
];

const USER_GET_PATTERNS = [
  /^\/api\/user\/(?:info|stats|privacy\/settings|season|matches|heroes\/frequent|friends)$/,
  /^\/api\/user\/matches\/hero\/[^/]+$/,
  /^\/api\/user\/matches\/[^/]+$/
];

const USER_POST_PATTERNS = [
  /^\/api\/user\/auth\/logout$/,
  /^\/api\/user\/privacy\/settings$/
];

function safeError(error: unknown) {
  if (error instanceof RoneApiError) {
    return {
      status: error.status,
      body: { ok: false, error: error.message, upstream: error.payload }
    };
  }
  return {
    status: 400,
    body: { ok: false, error: error instanceof Error ? error.message : "Rone API request failed" }
  };
}

function accountPayload(body: unknown) {
  const parsed = AccountSchema.parse(body);
  const role_id = Number(parsed.role_id ?? parsed.roleId);
  const zone_id = Number(parsed.zone_id ?? parsed.zoneId);
  if (!Number.isInteger(role_id) || !Number.isInteger(zone_id)) throw new Error("Game ID and Server ID are required.");
  return { role_id, zone_id };
}

function loginPayload(body: unknown) {
  const parsed = LoginSchema.parse(body);
  return { ...accountPayload(parsed), vc: Number(parsed.vc) };
}

function wildcardPath(req: FastifyRequest, prefix: "public" | "user") {
  const params = req.params as Record<string, string>;
  const raw = String(params["*"] ?? "").trim();
  if (!raw || raw.includes("?") || raw.includes("\\") || raw.split("/").includes("..")) {
    throw new Error("Unsupported Rone API path.");
  }
  const segments = raw.split("/").filter(Boolean).map((segment) => encodeURIComponent(decodeURIComponent(segment)));
  return `/api/${prefix === "public" ? "" : "user/"}${segments.join("/")}`;
}

function isAllowed(path: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(path));
}

function authorizationHeader(req: FastifyRequest) {
  const value = String(req.headers.authorization ?? "");
  if (!/^Bearer\s+\S+/.test(value)) throw new Error("Rone user token is required.");
  return value;
}

function sendLocalError(reply: FastifyReply, error: unknown, status = 400) {
  return reply.code(status).send({ ok: false, error: error instanceof Error ? error.message : "Rone API request failed" });
}

function payloadItems(payload: any) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.list)) return data.list;
  return [];
}

function heroName(item: any) {
  const data = item?.data ?? item;
  return item?.hid_e?.n ?? data?.hero?.data?.name ?? data?.name ?? data?.n ?? "";
}

function mythicName(stars: number) {
  if (stars >= 100) return "Mythical Immortal";
  if (stars >= 50) return "Mythical Glory";
  if (stars >= 25) return "Mythical Honor";
  return "Mythic";
}

function rankProfile(levelValue: unknown) {
  const level = Number(levelValue);
  if (!Number.isFinite(level) || level <= 0) return "";
  if (level >= 136) {
    const stars = Math.max(0, level - 136);
    return `${mythicName(stars)} ${stars} stars`;
  }
  return `Rank ${level}`;
}

async function syncSnapshotToPlayerProfile(snapshot: any) {
  const info = snapshot?.info?.data ?? {};
  const comfortHeroes = payloadItems(snapshot?.frequentHeroes).map(heroName).filter(Boolean).slice(0, 30);
  const rank = rankProfile(info.rank_level);
  if (!comfortHeroes.length && !rank) return null;
  const profile = await getPlayerProfile();
  return savePlayerProfile({
    ...profile,
    rankProfile: rank || profile.rankProfile,
    comfortHeroes: comfortHeroes.length ? comfortHeroes : profile.comfortHeroes,
  });
}

async function forward(reply: FastifyReply, path: string, options: { method?: "GET" | "POST"; query?: Record<string, unknown>; body?: unknown; authorization?: string }) {
  try {
    return await roneApi.request(path, options);
  } catch (error) {
    const result = safeError(error);
    return reply.code(result.status).send(result.body);
  }
}

export async function roneRoutes(app: FastifyInstance) {
  app.get("/api/rone/status", async (_req, reply) => {
    try {
      const version = await roneApi.request("/api/academy/meta/version");
      return {
        ok: true,
        baseUrl: RONE_API_BASE,
        publicProxy: true,
        userAuth: true,
        checkedAt: new Date().toISOString(),
        version
      };
    } catch (error) {
      const result = safeError(error);
      return reply.code(result.status).send(result.body);
    }
  });

  app.get("/api/rone/snapshot", async () => {
    return { ok: true, data: await cache.read<any | null>(snapshotFile, null) };
  });

  app.post("/api/rone/snapshot", async (req, reply) => {
    const parsed = SnapshotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: "A Rone snapshot payload is required." });
    const info = parsed.data.snapshot?.info?.data ?? {};
    const data = {
      storedAt: new Date().toISOString(),
      seasonId: parsed.data.seasonId,
      account: {
        name: info.name ?? info.nick_name ?? info.nickname ?? null,
        roleId: info.roleId ?? null,
        zoneId: info.zoneId ?? null,
        rankLevel: info.rank_level ?? null,
        historyRankLevel: info.history_rank_level ?? null
      },
      snapshot: parsed.data.snapshot
    };
    await cache.write(snapshotFile, data);
    await cache.setMetadata("rone-account-snapshot", {
      storedAt: data.storedAt,
      seasonId: data.seasonId,
      account: data.account
    });
    const profile = await syncSnapshotToPlayerProfile(parsed.data.snapshot);
    return { ok: true, data, profile };
  });

  app.delete("/api/rone/snapshot", async () => {
    await cache.write(snapshotFile, null);
    await cache.setMetadata("rone-account-snapshot", { storedAt: null, clearedAt: new Date().toISOString() });
    return { ok: true };
  });

  app.post("/api/rone/user/auth/send-vc", async (req, reply) => {
    try {
      return forward(reply, "/api/user/auth/send-vc", { method: "POST", body: accountPayload(req.body) });
    } catch (error) {
      return sendLocalError(reply, error);
    }
  });

  app.post("/api/rone/user/auth/login", async (req, reply) => {
    try {
      return forward(reply, "/api/user/auth/login", { method: "POST", body: loginPayload(req.body) });
    } catch (error) {
      return sendLocalError(reply, error);
    }
  });

  app.get("/api/rone/public/*", async (req, reply) => {
    let path: string;
    try {
      path = wildcardPath(req, "public");
    } catch (error) {
      return sendLocalError(reply, error);
    }
    if (!isAllowed(path, PUBLIC_GET_PATTERNS)) return reply.code(404).send({ ok: false, error: "Rone public path is not enabled." });
    return forward(reply, path, { query: req.query as Record<string, unknown> });
  });

  app.get("/api/rone/user/*", async (req, reply) => {
    let path: string;
    try {
      path = wildcardPath(req, "user");
    } catch (error) {
      return sendLocalError(reply, error);
    }
    if (!isAllowed(path, USER_GET_PATTERNS)) return reply.code(404).send({ ok: false, error: "Rone user path is not enabled." });
    try {
      return forward(reply, path, { query: req.query as Record<string, unknown>, authorization: authorizationHeader(req) });
    } catch (error) {
      return sendLocalError(reply, error, 401);
    }
  });

  app.post("/api/rone/user/*", async (req, reply) => {
    let path: string;
    try {
      path = wildcardPath(req, "user");
    } catch (error) {
      return sendLocalError(reply, error);
    }
    if (!isAllowed(path, USER_POST_PATTERNS)) return reply.code(404).send({ ok: false, error: "Rone user path is not enabled." });
    try {
      return forward(reply, path, { method: "POST", query: req.query as Record<string, unknown>, body: req.body, authorization: authorizationHeader(req) });
    } catch (error) {
      return sendLocalError(reply, error, 401);
    }
  });
}
