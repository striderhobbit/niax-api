export interface PagingObject<I> {
  index: number;
  pageToken: string;
  previousPageToken: string | null;
  nextPageToken: string | null;
  items: I[];
  pending?: boolean;
}
