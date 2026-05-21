import { GmsClient } from './GmsClient.js';
import { GMS_SOURCES } from './sources.js';

export async function fetchHeroMeta(client: GmsClient, rank = '101', matchType = 0) {
  return client.post<any>(GMS_SOURCES.HERO_META, {
    pageSize: 200,
    pageIndex: 1,
    filters: [
      { field: 'bigrank', operator: 'eq', value: rank },
      { field: 'match_type', operator: 'eq', value: matchType }
    ],
    sorts: [
      { data: { field: 'main_hero_win_rate', order: 'desc' }, type: 'sequence' },
      { data: { field: 'main_heroid', order: 'desc' }, type: 'sequence' }
    ],
    fields: [
      'main_hero',
      'main_hero_appearance_rate',
      'main_hero_ban_rate',
      'main_hero_channel',
      'main_hero_win_rate',
      'main_heroid',
      'data.sub_hero.hero',
      'data.sub_hero.hero_channel',
      'data.sub_hero.increase_win_rate',
      'data.sub_hero.heroid'
    ]
  });
}
