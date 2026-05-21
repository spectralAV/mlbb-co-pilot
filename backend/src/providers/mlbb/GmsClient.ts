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

export class GmsClient {
  constructor(private authorization: string, private lang = 'en') {}

  async post<T>(sourceId: number, body: GmsRequest): Promise<T> {
    if (!this.authorization) throw new Error('Missing GMS authorization token. Paste a fresh token in Settings → Data Sync.');

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

    if (!res.ok) throw new Error(`GMS ${sourceId} HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`GMS ${sourceId} error: ${json.message ?? JSON.stringify(json)}`);
    return json as T;
  }
}
