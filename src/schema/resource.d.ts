import { Dictionary } from 'express-serve-static-core';
import { GetFieldType } from 'lodash';
import { Path, UniqItem } from '.';
import { PagingObject } from './paging';

interface TypeMap {
  boolean: boolean;
  number: number;
  string: string;
}

type InverseTypeMap<K> = K extends boolean
  ? 'boolean'
  : K extends number
  ? 'number'
  : K extends string
  ? 'string'
  : never;

declare namespace Resource {
  type Routes<T extends UniqItem> = Partial<{
    [P in Path<T>]: {
      type: InverseTypeMap<GetFieldType<T, P>>;
    };
  }>;

  type TableColumns<T extends UniqItem> = Record<
    keyof Routes<T>,
    {
      filter?: string;
      include?: boolean;
      order?: 'asc' | 'desc';
      sortIndex?: number;
    }
  >;

  type Field<T extends UniqItem> = {
    [P in Path<T>]: Pick<T, 'id'> &
      Routes<T>[P] & {
        path: P;
      } & {
        value?: GetFieldType<T, P> | null;
      };
  }[Path<T>];

  interface Row<T extends UniqItem> {
    fields: Field<T>[];
    resource: Pick<T, 'id'>;
  }

  interface RawTable<T extends UniqItem> {
    columns: TableColumns<T>;
    hash: string;
    resource: string;
    rows: PagingObject<Row<T>>[];
  }

  interface TableHeader<T extends UniqItem> extends Omit<RawTable<T>, 'rows'> {
    pageToken?: string | null;
    resourceId?: string;
    rows: Dictionary<{}>;
  }

  interface Table<T extends UniqItem> extends Omit<TableHeader<T>, 'rows'> {
    rows: Dictionary<{
      items?: Row<T>[];
    }>;
  }
}
