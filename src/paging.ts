import { chunk } from 'lodash';
import objectHash from 'object-hash';
import { PagingObject } from './schema/paging';

export const paginate = <T>(items: T[], limit: number): PagingObject<T>[] =>
  chunk(items, limit)
    .map((items, index) => ({
      pageToken: objectHash({ items, limit, index }),
      items,
    }))
    .map((page, index, pages) => ({
      ...page,
      previousPageToken: pages[index - 1]?.pageToken ?? null,
      nextPageToken: pages[index + 1]?.pageToken ?? null,
    }));
