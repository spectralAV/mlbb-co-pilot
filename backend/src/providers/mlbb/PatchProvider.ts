import { GmsClient } from './GmsClient.js';
import { GMS_SOURCES, NEWS_CHANNELS } from './sources.js';

export async function fetchPatchArticles(client: GmsClient) {
  return client.post<any>(GMS_SOURCES.NEWS_ARTICLES, {
    pageSize: 100,
    pageIndex: 1,
    filters: [
      { field: 'channel', operator: 'hasAnyOf', value: [NEWS_CHANNELS.PATCH] },
      { field: 'title.(i18n)', operator: 'contain', value: '/.*/' },
      { field: 'title.(i18n)', operator: 'notEmpty' }
    ],
    sorts: [
      { data: { field: 'sort', order: 'desc' }, type: 'sequence' },
      { data: { field: 'start_time', order: 'desc' }, type: 'sequence' }
    ],
    fields: ['id', 'channel', 'kind', 'dynamic.views', 'cover', 'start_time', 'tag', 'title'],
    object: [2667533]
  });
}
