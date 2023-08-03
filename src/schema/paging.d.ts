export interface PagingObject<T> {
  pageToken: string;
  previousPageToken: string | null;
  nextPageToken: string | null;
  items: T[];
}
