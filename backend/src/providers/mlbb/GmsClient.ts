import { GMS_ACT_ID, GMS_APP_ID } from './sources.js';

export type GmsFilter = { field: string; operator: string; value?: unknown };
export type GmsSort = { data: { field: string; order: 'asc' | 'desc' }; type: 'sequence' };

export type GmsRequest = {
  pageSize?: number;
  pageIndex?: number;
  filters?: GmsFilter[];
  sorts?: GmsSort[];
  fields?: string[];
  object?: number[];
};

function isAuthFailure(status: number, message = "") {
  return status === 401
    || status === 403
    || /auth|token|login|expired|unauthori[sz]ed|forbidden/i.test(message);
}

function expiredTokenMessage() {
  return "GMS authorization token is expired or invalid. Paste a fresh GMS authorization token in Settings > Data Sync or update MLBB_GMS_AUTHORIZATION.";
}

export class GmsClient {
  constructor(private authorization: string, private lang = 'en') {}

  async post<T>(sourceId: number, body: GmsRequest): Promise<T> {
    if (!this.authorization) throw new Error('Missing GMS authorization token. Paste a fresh token in Settings > Data Sync or set MLBB_GMS_AUTHORIZATION.');

    const res = await fetch(`https://api.gms.moontontech.com/api/gms/source/${GMS_APP_ID}/${sourceId}`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json;charset=UTF-8',
        origin: 'https://www.mobilelegends.com',
        referer: 'https://www.mobilelegends.com/',
        authorization: this.authorization,
        'x-actid': String(GMS_ACT_ID),
        'x-appid': String(GMS_APP_ID),
        'x-lang': this.lang,
        'user-agent': 'MLBB-Co-Pilot/0.4.0'
      },
      body: JSON.stringify({ pageSize: 200, pageIndex: 1, filters: [], sorts: [], object: [], ...body })
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const upstreamMessage = String(json?.message ?? text ?? "");

    if (!res.ok) {
      if (isAuthFailure(res.status, upstreamMessage)) throw new Error(expiredTokenMessage());
      throw new Error(`GMS ${sourceId} HTTP ${res.status}`);
    }
    if (json?.code !== 0) {
      if (isAuthFailure(200, upstreamMessage)) throw new Error(expiredTokenMessage());
      throw new Error(`GMS ${sourceId} error: ${upstreamMessage || JSON.stringify(json)}`);
    }
    return json as T;
  }
}
