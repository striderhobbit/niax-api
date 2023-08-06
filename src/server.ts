import { json } from 'body-parser';
import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { StatusCodes } from 'http-status-codes';
import {
  Dictionary,
  find,
  get,
  keyBy,
  map,
  mapValues,
  orderBy,
  pick,
  set,
  sortBy,
} from 'lodash';
import morgan from 'morgan';
import objectHash from 'object-hash';
import { paginate } from './paging';
import { PromiseChain } from './promise';
import { Request } from './schema/request';
import { Resource } from './schema/resource';

export class Server<I extends Resource.Item> {
  private readonly app = express();
  private readonly chain = new PromiseChain();
  private readonly tables: Dictionary<Resource.Table<I>> = {};

  private readonly router = express
    .Router()
    .get<
      Request.GetResourceTable<I>['ReqParams'],
      Request.GetResourceTable<I>['ResBody'],
      Request.GetResourceTable<I>['ReqBody'],
      Request.GetResourceTable<I>['ReqQuery']
    >('/api/resource/table', (req, res, next) =>
      this.chain.push(async () => {
        const { hash, limit = 50, paths, resourceId, resourceName } = req.query;

        const items: I[] = (
          await readFile(`resource/${resourceName}.items.json`, 'utf-8').then(
            JSON.parse
          )
        ).slice(0, 50);

        const routes: Resource.Route<I>[] = await readFile(
          `resource/${resourceName}.routes.json`,
          'utf-8'
        ).then(JSON.parse);

        const columns: Resource.TableColumn<I>[] = (function (
          requestedColumns
        ) {
          return routes.map((route) => {
            const column = find(requestedColumns, { path: route.path });

            return {
              ...route,
              ...(column != null
                ? {
                    include: true,
                    ...pick(column, 'sortIndex', 'filter'),
                    ...(column.sortIndex != null ? pick(column, 'order') : {}),
                  }
                : {}),
            };
          });
        })(
          paths
            .split(',')
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
                  return order as 'desc';
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

        const primaryPaths = sortBy(columns, 'sortIndex').filter(
          ({ sortIndex }) => sortIndex != null
        );

        let table = this.tables[resourceName];

        if (
          table == null ||
          hash == null ||
          objectHash({ items, routes, columns, limit }) !== hash
        ) {
          const columnsDictionary = keyBy(columns, 'path');
          const requestedRoutes = routes.filter(
            (route) => columnsDictionary[route.path].include
          );

          const rows = items.map((item) => ({
            resource: pick(item, 'id'),
            fields: requestedRoutes.map(
              (route): Resource.TableField<I> => ({
                ...route,
                resource: pick(item, 'id'),
                value: get(item, route.path),
              })
            ),
          }));

          const fieldsDictionary = mapValues(
            keyBy(rows, 'resource.id'),
            (row) => keyBy(row.fields, 'path')
          );

          table = this.tables[resourceName] = {
            resource: {
              name: resourceName,
            },
            hash: objectHash({ items, routes, columns, limit }),
            columns,
            primaryPaths: map(primaryPaths, 'path'),
            rowsPages: paginate(
              orderBy(
                rows.filter((row) =>
                  columns.every(
                    (column) =>
                      column.filter == null ||
                      new RegExp(column.filter, 'i').test(
                        fieldsDictionary[row.resource.id][
                          column.path
                        ].value?.toString() ?? ''
                      )
                  )
                ),
                primaryPaths.map(
                  (primaryPath) => (row) =>
                    fieldsDictionary[row.resource.id][primaryPath.path].value
                ),
                primaryPaths.map(({ order = 'asc' }) => order)
              ),
              +limit
            ),
          };
        }

        const requestedRowsPage = table.rowsPages.find((rowsPage) =>
          find(rowsPage.items, { resource: { id: resourceId } })
        );

        res.send({
          ...table,
          resource: {
            ...table.resource,
            id: requestedRowsPage && resourceId,
          },
          rowsPages: table.rowsPages.map((rowsPage, index) => {
            const deferred =
              requestedRowsPage == null
                ? index !== 0
                : rowsPage !== requestedRowsPage;

            return {
              ...rowsPage,
              items: deferred ? [] : rowsPage.items,
              deferred,
            };
          }),
        });
      }, next)
    )
    .get<
      Request.GetResourceTableRowsPage<I>['ReqParams'],
      Request.GetResourceTableRowsPage<I>['ResBody'],
      Request.GetResourceTableRowsPage<I>['ReqBody'],
      Request.GetResourceTableRowsPage<I>['ReqQuery']
    >('/api/resource/table/rows/page', (req, res, next) => {
      const { pageToken, resourceName } = req.query;

      res.send(find(this.tables[resourceName].rowsPages, { pageToken }));
    })
    .patch<
      Request.PatchResourceItem<I>['ReqParams'],
      Request.PatchResourceItem<I>['ResBody'],
      Request.PatchResourceItem<I>['ReqBody'],
      Request.PatchResourceItem<I>['ReqQuery']
    >('/api/resource/item', (req, res, next) =>
      this.chain.push(() => {
        const { resourceName } = req.query,
          {
            resource: { id },
            path,
            value,
          } = req.body;

        const getItem = (items: I[], id: string): I => {
          const item = items.find((item) => item.id === id);

          if (item == null) {
            throw new Error(`${resourceName} ${JSON.stringify(id)} not found`);
          }

          return item;
        };

        return readFile(`resource/${resourceName}.items.json`, 'utf-8')
          .then<I[]>(JSON.parse)
          .then((items) => {
            set(getItem(items, id), path, value);

            delete this.tables[resourceName];

            return items;
          })
          .then((items) =>
            writeFile(
              `resource/${resourceName}.items.json`,
              JSON.stringify(items, null, '\t')
            ).then(() => res.send(getItem(items, id)))
          );
      }, next)
    );

  constructor(private readonly port: number) {
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
