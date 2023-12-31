import { GetFieldType } from 'lodash';
import { Subject } from 'rxjs';
import { PagingObject } from './paging';
import { IsNullable, PropertyPath } from './utility';

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

export namespace Resource {
  interface Item {
    id: string;
  }

  interface SingleRoute<I extends Item, P extends PropertyPath<I>> {
    path: P;
    type: InverseTypeMap<GetFieldType<I, P>>;
    nullable: IsNullable<GetFieldType<I, P>>;
  }

  type Routes<I extends Item> = {
    [P in PropertyPath<I>]: SingleRoute<I, P>;
  };

  type Route<I extends Item> = Routes<I>[PropertyPath<I>];

  interface SingleTableColumn<I extends Item, P extends PropertyPath<I>>
    extends SingleRoute<I, P> {
    include?: boolean;
    sortIndex?: number;
    order?: 'asc' | 'desc' | '';
    filter?: string;
  }

  type TableColumns<I extends Item> = {
    [P in PropertyPath<I>]: SingleTableColumn<I, P>;
  };

  type TableColumn<I extends Item> = TableColumns<I>[PropertyPath<I>];

  interface SingleTableField<I extends Item, P extends PropertyPath<I>>
    extends SingleRoute<I, P> {
    resourceId: string;
    value: GetFieldType<I, P>;
  }

  type TableFields<I extends Item> = {
    [P in PropertyPath<I>]: SingleTableField<I, P>;
  };

  type TableField<I extends Item> = TableFields<I>[PropertyPath<I>];

  interface TableRow<I extends Item> {
    resourceId: string;
    fields: TableFields<I>;
    index: number;
  }

  interface TableRowsPage<I extends Item> extends PagingObject<TableRow<I>> {}

  interface Table<I extends Item> {
    columns: TableColumn<I>[];
    primaryPaths: PropertyPath<I>[];
    secondaryPaths: PropertyPath<I>[];
    rowsPages: TableRowsPage<I>[];
    query: TableQuery;
    token: string;
    totalRows: number;
    signature?: TableSignature<I>;
    rowsPagesUpdates?: Subject<void>;
  }

  interface TableQuery {
    limit: number;
    cols: string;
    resourceId?: string;
    resourceName: string;
  }

  interface TableSignature<I extends Item>
    extends Pick<Table<I>, 'token' | 'totalRows'> {
    originalUrl: string;
    restoredFromCache: boolean;
    revision: string;
    timestamp: string;
  }
}
