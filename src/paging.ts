import { ListIterateeCustom, chunk, find, stubFalse } from 'lodash';
import objectHash from 'object-hash';
import { PagingObject } from './schema/paging';

export const paginate = <I>(
  items: I[],
  limit: number,
  promote: ListIterateeCustom<I, boolean> = stubFalse
): PagingObject<I>[] => {
  const chunks: I[][] = [];
  const promoteItem = find(items, promote);

  if (promoteItem != null) {
    const residuum = items.indexOf(promoteItem) % limit;

    if (residuum) {
      chunks.push(items.slice(0, residuum));
    }

    chunks.push(...chunk(items.slice(residuum), limit));
  } else {
    chunks.push(...chunk(items, limit));
  }

  return chunks
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
};
