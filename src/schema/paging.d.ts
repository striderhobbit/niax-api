export interface PagingObject<I> {
  pageToken: string;
  previousPageToken: string | null;
  nextPageToken: string | null;
  items: I[];
}
