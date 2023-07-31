export interface PagingObject<T> {
  pageToken: string;
  items: T[];
  previousPageToken: string | null;
  nextPageToken: string | null;
}
