import { GmsClient } from './GmsClient.js';
import { GMS_SOURCES } from './sources.js';

export async function fetchHeroDirectory(client: GmsClient) {
  return client.post<any>(GMS_SOURCES.HERO_DIRECTORY, {
    pageSize: 200,
    pageIndex: 1,
    filters: [
      { field: '<hero.data.sortid>', operator: 'hasAnyOf', value: [1, 2, 3, 4, 5, 6] },
      { field: '<hero.data.roadsort>', operator: 'hasAnyOf', value: [1, 2, 3, 4, 5] }
    ],
    sorts: [{ data: { field: 'hero_id', order: 'desc' }, type: 'sequence' }],
    fields: ['id', 'hero_id', 'hero.data.name', 'hero.data.smallmap', 'hero.data.sortid', 'hero.data.roadsort', 'relation'],
    object: []
  });
}
