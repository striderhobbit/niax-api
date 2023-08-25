import { json } from 'body-parser';
import { execSync } from 'child_process';
import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
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
import { Subject, defer, from, mergeAll, tap } from 'rxjs';
import { WebSocketServer } from 'ws';
import { checkTypes } from './compile';
import { paginate } from './paging';
import { ResourceService } from './resource';
import { multiBufferExhaustMap } from './rxjs';
import { Request } from './schema/request';
import { Resource } from './schema/resource';
import { WebSocket } from './schema/ws';

class TableCache<I extends Resource.Item> {
  private readonly tables: Resource.Table<I>[] = [];

  constructor(private readonly LIMIT: number) {}

  public add(table: Resource.Table<I>): Resource.Table<I> {
    if (find(this.tables, pick(table, 'token')) != null) {
      throw new Error(`duplicate table ${table.token}`);
    }

    this.tables.unshift(table);

    this.tables.length = Math.min(this.tables.length, this.LIMIT);

    return table;
  }

  public delete(table: Resource.Table<I> | undefined): void {
    pull(this.tables, table);
  }

  public first(): Resource.Table<I> | undefined {
    return this.tables[0];
  }

  public getItem(token: string): Resource.Table<I> | undefined {
    return find(this.tables, { token });
  }

  public promote(table: Resource.Table<I>): Resource.Table<I> {
    switch (this.tables.indexOf(table)) {
      case -1:
        throw new Error(`table ${table.token} not found`);
      case 0:
        break;
      default:
        pull(this.tables, table);

        this.tables.unshift(table);
    }

    return table;
  }
}

export class Server<I extends Resource.Item> {
  private readonly app = express();
  private readonly requests = new Subject<any>();
  private readonly tableCache = new TableCache<I>(5);
  private readonly typeChecks = new Subject<string>();
  private readonly wss = new WebSocketServer({ port: this.webSocketPort });

  private readonly router = express
    .Router()
    .get<
      Request.GetResourceTable<I>['ReqParams'],
      Request.GetResourceTable<I>['ResBody'],
      Request.GetResourceTable<I>['ReqBody'],
      Request.GetResourceTable<I>['ReqQuery']
    >('/api/resource/table', (req, res, next) =>
      this.requests.next(
        defer(async () => {
          const { cols = '' } = req.query;
          const limit = Math.min(+(req.query.limit ?? 50), 100);

          const resource = new ResourceService<I>(
            req.query.resourceName,
            req.query.resourceId
          );

          const items = await resource.getItems();
          const routes = await resource.getRoutes();

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
            (cols ? cols.split(',') : [])
              .map(
                (path) =>
                  path.match(
                    /^(?<path>[^:,]*):(?<sortIndex>\d*):(?<order>asc|desc|):(?<filter>[^,]*)$/
                  )!.groups
              )
              .map((groups) => ({
                path: groups!['path'],
                sortIndex: (function (sortIndex: string) {
                  if (sortIndex) {
                    return +sortIndex;
                  }

                  return;
                })(groups!['sortIndex']),
                order: (function (order: string) {
                  if (order === 'desc') {
                    return order;
                  }

                  return;
                })(groups!['order']),
                filter: (function (filter: string) {
                  if (filter) {
                    return filter;
                  }

                  return;
                })(groups!['filter']),
              }))
          );

          const token = objectHash({
            columns,
            items,
            limit,
            resourceId: resource.id,
            resourceName: resource.name,
            routes,
          });

          const restored = this.tableCache.getItem(token);
          let table: Resource.Table<I>;

          if (restored == null) {
            const requestedRoutes = routes.filter(
              (route) =>
                columns.find((column) => column.path === route.path)!.include
            );

            const primaryColumns = sortBy(columns, 'sortIndex').filter(
              ({ sortIndex }) => sortIndex != null
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

            const filteredAndSortedRows = orderBy(
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
            ).map((row, index) => Object.assign(row, { index }));

            table = this.tableCache.add({
              columns,
              primaryPaths: map(primaryColumns, 'path'),
              secondaryPaths: map(
                columns.filter(
                  (column) => column.include && column.sortIndex == null
                ),
                'path'
              ),
              rowsPages: paginate(
                filteredAndSortedRows,
                limit,
                (row) => row.resource.id === resource.id
              ),
              query: {
                limit,
                cols,
                resourceId: resource.id,
                resourceName: resource.name,
              },
              token,
              totalRows: filteredAndSortedRows.length,
            });
          } else {
            table = this.tableCache.promote(restored);
          }

          const requestedRowsPage = table.rowsPages.find((rowsPage) =>
            find(rowsPage.items, { resource: { id: resource.id } })
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
            signature: {
              ...pick(table, 'token', 'totalRows'),
              originalUrl: req.originalUrl,
              restoredFromCache: restored != null,
              revision: execSync('git rev-parse HEAD').toString().trim(),
              timestamp: new Date().toISOString(),
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
      this.requests.next(
        defer(() => {
          const table = this.tableCache.getItem(req.query.tableToken),
            { path, value } = req.body;

          const resource = new ResourceService<I>(
            table!.query.resourceName,
            req.body.resource.id
          );

          return resource
            .getItems()
            .then((items) => {
              set(resource.findItemIn(items), path, value);

              this.tableCache.delete(table);

              return items;
            })
            .then((items) => resource.setItems(items))
            .then((items) => res.send(resource.findItemIn(items)))
            .then(() => this.typeChecks.next(resource.name));
        })
      )
    );

  constructor(
    private readonly port: number,
    private readonly webSocketPort: number
  ) {
    console.clear();

    this.requests.pipe(mergeAll(1)).subscribe();

    this.typeChecks
      .pipe(
        multiBufferExhaustMap((resourceName) =>
          from(checkTypes(resourceName)).pipe(
            tap((errors) =>
              this.broadcast({
                type: 'error',
                body: errors,
              })
            )
          )
        )
      )
      .subscribe();

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

    this.app.listen(this.port, () =>
      console.info(`Server is listening on port ${this.port}.`)
    );

    this.wss.on('listening', () =>
      console.info(
        `WebSocketServer is listening on port ${this.webSocketPort}.`
      )
    );

    this.wss.on('connection', (ws) => {
      ws.on('close', () =>
        console.info(`Client disconnected (total = ${this.wss.clients.size}).`)
      );

      console.info(`New client connected (total = ${this.wss.clients.size}).`);

      this.broadcast({
        type: 'text',
        body: 'ping',
      });
    });
  }

  private broadcast(message: WebSocket.Message): void {
    const data = JSON.stringify(message);

    this.wss.clients.forEach((ws) => ws.send(data));
  }
}
