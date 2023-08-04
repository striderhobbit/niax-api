import { json } from 'body-parser';
import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { StatusCodes } from 'http-status-codes';
import {
  Dictionary,
  find,
  forOwn,
  get,
  map,
  mapValues,
  orderBy,
  pick,
  set,
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
    >('/api/resource/table/:resource', (req, res, next) =>
      this.chain.push(async () => {
        const { resource } = req.params,
          { hash, limit = 50, resourceId } = req.query;

        const items: I[] = (
          await readFile(`resource/${resource}.items.json`, 'utf-8').then(
            JSON.parse
          )
        ).slice(0, 50);

        const routes: Resource.Routes<I> = await readFile(
          `resource/${resource}.routes.json`,
          'utf-8'
        ).then(JSON.parse);

        const paths = req.query.paths
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
              if (order) {
                return order as 'asc' | 'desc';
              }

              return;
            })(groups['order']),
            filter: (function (filter: string) {
              if (filter) {
                return filter;
              }

              return;
            })(groups['filter']),
          }));

        const columns: Resource.TableColumns<I> = mapValues(routes, (route) => {
          const path = find(paths, { path: route.path });
          const include = path != null;

          return {
            ...route,
            include,
            ...(include ? pick(path, 'sortIndex', 'order', 'filter') : {}),
          };
        });

        let table = this.tables[resource];

        if (
          table == null ||
          hash == null ||
          objectHash({ items, routes, columns, limit }) !== hash
        ) {
          const selectedRoutes: Resource.Route<I>[] = [];

          forOwn(routes, (route) => {
            if (columns[route.path].include) {
              selectedRoutes.push(route);
            }
          });

          table = this.tables[resource] = {
            resource,
            hash: objectHash({ items, routes, columns, limit }),
            columns,
            rowsPages: paginate(
              items.map((item) => ({
                resource: pick(item, 'id'),
                fields: selectedRoutes.map((route) => ({
                  ...route,
                  resource: pick(item, 'id'),
                  value: get(item, route.path),
                })),
              })),
              +limit
            ),
          };
        }

        res.send({
          ...table,
          rowsPages: Object.fromEntries(
            table.rowsPages.map(
              ({ pageToken, previousPageToken, nextPageToken }) => [
                pageToken,
                { pageToken, previousPageToken, nextPageToken },
              ]
            )
          ),
          query: {
            pageToken: (
              table.rowsPages.find((rowsPage) =>
                find(rowsPage.items, { resource: { id: resourceId } })
              ) ?? table.rowsPages[0]
            )?.pageToken,
            resourceId,
          },
          $primaryPaths: map(
            orderBy(columns, 'sortIndex').filter(
              ({ sortIndex }) => sortIndex != null
            ),
            'path'
          ),
        });
      }, next)
    )
    .get<
      Request.GetResourceTableRowsPage<I>['ReqParams'],
      Request.GetResourceTableRowsPage<I>['ResBody'],
      Request.GetResourceTableRowsPage<I>['ReqBody'],
      Request.GetResourceTableRowsPage<I>['ReqQuery']
    >('/api/resource/table/rows/page/:resource', (req, res, next) =>
      res.send(
        find(this.tables[req.params.resource].rowsPages, {
          pageToken: req.query.pageToken,
        })
      )
    )
    .patch<
      Request.PatchResourceItem<I>['ReqParams'],
      Request.PatchResourceItem<I>['ResBody'],
      Request.PatchResourceItem<I>['ReqBody'],
      Request.PatchResourceItem<I>['ReqQuery']
    >('/api/:resource/item', (req, res, next) =>
      this.chain.push(() => {
        const { resource } = req.params,
          {
            resource: { id },
            path,
            value,
          } = req.body;

        const getItem = (items: I[], id: string): I => {
          const item = items.find((item) => item.id === id);

          if (item == null) {
            throw new Error(`${resource} ${JSON.stringify(id)} not found`);
          }

          return item;
        };

        return readFile(`resource/${resource}.items.json`, 'utf-8')
          .then<I[]>(JSON.parse)
          .then((items) => {
            set(getItem(items, id), path, value);

            delete this.tables[resource];

            return items;
          })
          .then((items) =>
            writeFile(
              `resource/${resource}.items.json`,
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
