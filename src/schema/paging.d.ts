export interface PagingObjectHeader<T> {
  pageToken: string;
  previousPageToken: string | null;
  nextPageToken: string | null;
}

export interface PagingObject<T> extends PagingObjectHeader<T> {
  items?: T[];
}
