import { json } from 'body-parser';
import { execSync } from 'child_process';
import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { get, keyBy, map, orderBy, pick, set, sortBy } from 'lodash';
import morgan from 'morgan';
import objectHash from 'object-hash';
import { Subject, defer, from, mergeAll } from 'rxjs';
import { WebSocketServer } from 'ws';
import { ItemsCache } from './cache';
import { checkTypes } from './compile';
import { paginate } from './paging';
import { ResourceService } from './resource';
import { groupBufferSwitchMap } from './rxjs';
import { Request } from './schema/request';
import { Resource } from './schema/resource';
import { WebSocket } from './schema/ws';

interface ServerConfig<I extends Resource.Item> {
  port: number;
  webSocketPort: number;
  restoreTables?: Resource.Table<I>[];
}

export class Server<I extends Resource.Item> {
  private readonly app = express();
  private readonly requests = new Subject<any>();
  private readonly typeChecks = new Subject<string>();
  private readonly wss = new WebSocketServer({
    port: this.config.webSocketPort,
  });

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
              const column = requestedColumns.find(
                (column) => column.path === route.path
              );

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

          const restoredTable = this.tableCache.tryGetItem(token);
          let table: Resource.Table<I>;

          if (restoredTable == null) {
            const requestedRoutes = routes.filter(
              (route) =>
                columns.find((column) => column.path === route.path)!.include
            );

            const primaryColumns = sortBy(columns, 'sortIndex').filter(
              ({ sortIndex }) => sortIndex != null
            );

            const rows = items.map((item, index) => ({
              resourceId: item.id,
              fields: keyBy(
                requestedRoutes.map(
                  (route): Resource.TableField<I> => ({
                    ...route,
                    resourceId: item.id,
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
                (row) => row.resourceId === resource.id
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
            table = this.tableCache.promoteItem(restoredTable.token);
          }

          const requestedRowsPage = table.rowsPages.find((rowsPage) =>
            rowsPage.items.find((row) => row.resourceId === resource.id)
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
              restoredFromCache: restoredTable != null,
              revision: execSync('git rev-parse HEAD').toString().trim(),
              timestamp: new Date().toISOString(),
            },
          });

          this.typeChecks.next(resource.name);
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
        this.tableCache
          .getItem(tableToken)
          .rowsPages.find((rowsPage) => rowsPage.pageToken === pageToken)
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
            table.query.resourceName,
            req.body.resourceId
          );

          return resource
            .getItems()
            .then((items) => {
              set(resource.findItemIn(items), path, value);

              this.tableCache.deleteItem(table.token);

              return items;
            })
            .then((items) => resource.setItems(items))
            .then((items) => res.send(resource.findItemIn(items)))
            .then(() => this.typeChecks.next(resource.name));
        })
      )
    );

  public readonly tableCache = new ItemsCache<Resource.Table<I>>({
    limit: 5,
    startWith: this.config.restoreTables,
  });

  constructor(private readonly config: ServerConfig<I>) {
    console.clear();

    this.requests.pipe(mergeAll(1)).subscribe();

    this.typeChecks
      .pipe(
        groupBufferSwitchMap((resourceName) => from(checkTypes(resourceName)))
      )
      .subscribe({
        next: (errors) =>
          this.broadcast({
            type: 'text',
            subType: 'error',
            body: errors,
          }),
      });

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

    this.app.listen(this.config.port, () =>
      console.info(`Server is listening on port ${this.config.port}.`)
    );

    this.wss.on('listening', () =>
      console.info(
        `WebSocketServer is listening on port ${this.config.webSocketPort}.`
      )
    );

    this.wss.on('connection', (ws) => {
      ws.on('close', () =>
        console.info(`Client disconnected (total = ${this.wss.clients.size}).`)
      );

      console.info(`New client connected (total = ${this.wss.clients.size}).`);
    });
  }

  private broadcast(message: WebSocket.Message): void {
    const data = JSON.stringify(message);

    this.wss.clients.forEach((ws) => ws.send(data));
  }
}
