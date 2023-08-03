import { Dictionary } from 'express-serve-static-core';
import { GetFieldType } from 'lodash';
import { Optional } from 'utility-types';
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

  interface TableRowsPage<T extends UniqItem>
    extends PagingObject<TableRow<T>> {}

  interface TableRowsPageHeader<T extends UniqItem>
    extends Optional<TableRowsPage<T>, 'items'> {}

  interface RawTable<T extends UniqItem> {
    columns: TableColumns<T>;
    hash: string;
    resource: string;
    rowsPages: TableRowsPage<T>[];
  }

  interface Table<T extends UniqItem> extends Omit<RawTable<T>, 'rowsPages'> {
    rowsPages: Dictionary<TableRowsPageHeader<T>>;
    pageToken?: string | null;
    resourceId?: string;
  }
}
