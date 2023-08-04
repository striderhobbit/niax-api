import { Dictionary } from 'express-serve-static-core';
import { GetFieldType } from 'lodash';
import { Optional } from 'utility-types';
import { PagingObject } from './paging';
import { PropertyPath } from './utility';

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
  interface Item {
    id: string;
  }

  interface SingleRoute<I extends Item, P extends PropertyPath<I>> {
    path: P;
    type: InverseTypeMap<GetFieldType<I, P>>;
  }

  type Routes<I extends Item> = {
    [P in PropertyPath<I>]: SingleRoute<I, P>;
  };

  type Route<I extends Item> = Routes<I>[PropertyPath<I>];

  interface SingleTableColumn<I extends Item, P extends PropertyPath<I>>
    extends SingleRoute<I, P> {
    include?: boolean;
    sortIndex?: number;
    order?: 'asc' | 'desc';
    filter?: string;
  }

  type TableColumns<I extends Item> = {
    [P in PropertyPath<I>]: SingleTableColumn<I, P>;
  };

  type TableColumn<I extends Item> = TableColumns<I>[PropertyPath<I>];

  interface SingleTableField<I extends Item, P extends PropertyPath<I>>
    extends SingleRoute<I, P> {
    resource: Pick<I, 'id'>;
    value?: GetFieldType<I, P> | null;
  }

  type TableFields<I extends Item> = {
    [P in PropertyPath<I>]: SingleTableField<I, P>;
  };

  type TableField<I extends Item> = TableFields<I>[PropertyPath<I>];

  interface TableRow<I extends Item> {
    resource: Pick<I, 'id'>;
    fields: TableField<I>[];
  }

  interface TableRowsPage<I extends Item> extends PagingObject<TableRow<I>> {}

  interface TableRowsPageHeader<I extends Item>
    extends Optional<TableRowsPage<I>, 'items'> {}

  interface Table<I extends Item> {
    resource: string;
    hash: string;
    columns: TableColumns<I>;
    rowsPages: TableRowsPage<I>[];
  }

  interface TableHeader<I extends Item> extends Omit<Table<I>, 'rowsPages'> {
    rowsPages: Dictionary<TableRowsPageHeader<I>>;
    query: {
      pageToken?: string | null;
      resourceId?: string;
    };
  }
}
