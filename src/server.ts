import { json } from 'body-parser';
import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { StatusCodes } from 'http-status-codes';
import {
  find,
  get,
  keyBy,
  map,
  orderBy,
  pick,
  pull,
  set,
  sortBy,
} from 'lodash';
import morgan from 'morgan';
import objectHash from 'object-hash';
import { Subject, defer, mergeAll } from 'rxjs';
import { paginate } from './paging';
import { Request } from './schema/request';
import { Resource } from './schema/resource';

class TableCache<I extends Resource.Item> {
  private readonly tables: Resource.Table<I>[] = [];

  constructor(private readonly LIMIT: number) {}

  public add(table: Resource.Table<I>): void {
    if (find(this.tables, pick(table, 'params.token')) != null) {
      throw new Error(`duplicate table ${table.params.token}`);
    }

    this.tables.unshift(table);

    this.tables.length = Math.min(this.tables.length, this.LIMIT);
  }

  public first(): Resource.Table<I> | undefined {
    return this.tables[0];
  }

  public getItem(token: string): Resource.Table<I> | undefined {
    return find(this.tables, { params: { token } });
  }

  public promote(table: Resource.Table<I>): void {
    if (this.tables.indexOf(table) !== 0) {
      pull(this.tables, table);

      this.tables.unshift(table);
    }
  }
}

export class Server<I extends Resource.Item> {
  private readonly app = express();
  private readonly queue = new Subject<any>();
  private readonly tableCache = new TableCache<I>(5);

  private readonly router = express
    .Router()
    .get<
      Request.GetResourceTable<I>['ReqParams'],
      Request.GetResourceTable<I>['ResBody'],
      Request.GetResourceTable<I>['ReqBody'],
      Request.GetResourceTable<I>['ReqQuery']
    >('/api/resource/table', (req, res, next) =>
      this.queue.next(
        defer(async () => {
          const { cols = '', resourceId, resourceName } = req.query;

          const limit = Math.min(+(req.query.limit ?? 50), 100);

          const items: I[] = await readFile(
            `resource/${resourceName}.items.json`,
            'utf-8'
          ).then(JSON.parse);

          const routes: Resource.Route<I>[] = await readFile(
            `resource/${resourceName}.routes.json`,
            'utf-8'
          ).then(JSON.parse);

          const columns: Resource.TableColumn<I>[] = (function (
            requestedColumns
          ) {
            return routes.map((route) => {
              const column = find(requestedColumns, { path: route.path });

              return column == null
                ? route
                : {
                    ...route,
                    include: true,
                    ...pick(column, 'sortIndex', 'filter'),
                    ...(column.sortIndex != null ? pick(column, 'order') : {}),
                  };
            });
          })(
            cols
              ?.split(',')
              .map(
                (path) =>
                  path.match(
                    /^(?<path>[^:,]*):(?<sortIndex>\d*):(?<order>asc|desc|):(?<filter>[^,]*)$/
                  )!.groups!
              )
              .map((groups) => ({
                path: groups['path'],
                sortIndex: (function (sortIndex: string) {
                  if (sortIndex) {
                    return +sortIndex;
                  }

                  return;
                })(groups['sortIndex']),
                order: (function (order: string) {
                  if (order === 'desc') {
                    return order;
                  }

                  return;
                })(groups['order']),
                filter: (function (filter: string) {
                  if (filter) {
                    return filter;
                  }

                  return;
                })(groups['filter']),
              }))
          );

          const token = objectHash({
            columns,
            items,
            limit,
            resourceName,
            routes,
          });

          const restored = this.tableCache.getItem(token);

          if (restored == null) {
            const requestedRoutes = routes.filter(
              (route) =>
                columns.find((column) => column.path === route.path)!.include
            );

            const rows = items.map((item, index) => ({
              resource: pick(item, 'id'),
              fields: keyBy(
                requestedRoutes.map(
                  (route): Resource.TableField<I> => ({
                    ...route,
                    resource: pick(item, 'id'),
                    value: get(item, route.path),
                  })
                ),
                'path'
              ),
              index,
            }));

            const primaryColumns = sortBy(columns, 'sortIndex').filter(
              ({ sortIndex }) => sortIndex != null
            );

            const table = {
              columns,
              primaryPaths: map(primaryColumns, 'path'),
              secondaryPaths: map(
                columns.filter(
                  (column) => column.include && column.sortIndex == null
                ),
                'path'
              ),
              rowsPages: paginate(
                orderBy(
                  rows.filter((row) =>
                    columns.every(
                      (column) =>
                        column.filter == null ||
                        new RegExp(column.filter, 'i').test(
                          row.fields[column.path].value?.toString() ?? ''
                        )
                    )
                  ),
                  primaryColumns.map(
                    (primaryPath) => (row) => row.fields[primaryPath.path].value
                  ),
                  primaryColumns.map(({ order }) => order || 'asc')
                ).map((row, index) => ({ ...row, index })),
                limit
              ),
              params: {
                token,
                limit,
                cols,
                resourceName,
              },
            };

            this.tableCache.add(table);
          } else {
            this.tableCache.promote(restored);
          }

          const table = this.tableCache.first()!;

          const requestedRowsPage = table.rowsPages.find((rowsPage) =>
            find(rowsPage.items, { resource: { id: resourceId } })
          );

          res.send({
            ...table,
            rowsPages: table.rowsPages.map((rowsPage, index) => {
              const pending =
                requestedRowsPage == null
                  ? index !== 0
                  : rowsPage !== requestedRowsPage;

              return {
                ...rowsPage,
                items: pending ? [] : rowsPage.items,
                pending,
              };
            }),
            params: {
              ...table.params,
              resourceId,
            },
          });
        })
      )
    )
    .get<
      Request.GetResourceTableRowsPage<I>['ReqParams'],
      Request.GetResourceTableRowsPage<I>['ResBody'],
      Request.GetResourceTableRowsPage<I>['ReqBody'],
      Request.GetResourceTableRowsPage<I>['ReqQuery']
    >('/api/resource/table/rows/page', (req, res, next) => {
      const { tableToken, pageToken } = req.query;

      res.send(
        find(this.tableCache.getItem(tableToken)!.rowsPages, {
          pageToken,
        })
      );
    })
    .patch<
      Request.PatchResourceItem<I>['ReqParams'],
      Request.PatchResourceItem<I>['ResBody'],
      Request.PatchResourceItem<I>['ReqBody'],
      Request.PatchResourceItem<I>['ReqQuery']
    >('/api/resource/item', (req, res, next) =>
      this.queue.next(
        defer(() => {
          const { tableToken } = req.query,
            {
              params: { resourceName },
            } = this.tableCache.getItem(tableToken)!,
            {
              resource: { id },
              path,
              value,
            } = req.body;

          const getItem = (items: I[], id: string): I => {
            const item = items.find((item) => item.id === id);

            if (item == null) {
              throw new Error(
                `${resourceName} ${JSON.stringify(id)} not found`
              );
            }

            return item;
          };

          return readFile(`resource/${resourceName}.items.json`, 'utf-8')
            .then<I[]>(JSON.parse)
            .then((items) => (set(getItem(items, id), path, value), items))
            .then((items) =>
              writeFile(
                `resource/${resourceName}.items.json`,
                JSON.stringify(items, null, '\t')
              ).then(() => res.send(getItem(items, id)))
            );
        })
      )
    );

  constructor(private readonly port: number) {
    this.queue.pipe(mergeAll(1)).subscribe();

    this.app.use(json());
    this.app.use(cors());
    this.app.use(morgan('dev'));
    this.app.use(this.router);

    const errorLogger: ErrorRequestHandler = (err, req, res, next) => {
      console.error(err.message);

      next(err);
    };

    const errorResponder: ErrorRequestHandler = (err, req, res, next) =>
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).send(err.message);

    const invalidPathHandler: RequestHandler = (req, res, next) =>
      res.status(StatusCodes.NOT_FOUND).send('unknown route');

    this.app.use(errorLogger);
    this.app.use(errorResponder);
    this.app.use(invalidPathHandler);

    this.app.listen(this.port, () => {
      console.clear();
      console.info(`Server is listening on port ${this.port}.`);
    });
  }
}
