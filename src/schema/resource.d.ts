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

  interface TableColumn {
    filter?: string;
    include?: boolean;
    order?: 'asc' | 'desc';
    sortIndex?: number;
  }

  type TableColumns<T extends UniqItem> = Record<keyof Routes<T>, TableColumn>;

  type TableField<T extends UniqItem> = {
    [P in Path<T>]: Pick<T, 'id'> &
      Routes<T>[P] & {
        path: P;
      } & {
        value?: GetFieldType<T, P> | null;
      };
  }[Path<T>];

  interface TableRow<T extends UniqItem> {
    fields: TableField<T>[];
    resource: Pick<T, 'id'>;
  }

  interface RawTable<T extends UniqItem> {
    columns: TableColumns<T>;
    hash: string;
    resource: string;
    rows: PagingObject<TableRow<T>>[];
  }

  interface TableHeader<T extends UniqItem> extends Omit<RawTable<T>, 'rows'> {
    rows: Dictionary<{}>;
    pageToken?: string | null;
    resourceId?: string;
  }

  interface Table<T extends UniqItem> extends Omit<TableHeader<T>, 'rows'> {
    rows: Dictionary<{
      items?: TableRow<T>[];
    }>;
  }
}
