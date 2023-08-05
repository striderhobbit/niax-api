import { chunk } from 'lodash';
import objectHash from 'object-hash';
import { PagingObject } from './schema/paging';

export const paginate = <I>(items: I[], limit: number): PagingObject<I>[] =>
  chunk(items, limit)
    .map((items, index) => ({
      index,
      pageToken: objectHash({ items, limit, index }),
      items,
    }))
    .map((page, index, pages) => ({
      ...page,
      previousPageToken: pages[index - 1]?.pageToken ?? null,
      nextPageToken: pages[index + 1]?.pageToken ?? null,
    }));
