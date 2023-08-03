import { json } from 'body-parser';
import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { StatusCodes } from 'http-status-codes';
import { Dictionary, filter, find, get, pick, set } from 'lodash';
import morgan from 'morgan';
import objectHash from 'object-hash';
import { paginate } from './paging';
import { PromiseChain } from './promise';
import { Path, UniqItem } from './schema';
import { Request } from './schema/request';
import { Resource } from './schema/resource';

export class Server<T extends UniqItem> {
  private readonly app = express();
  private readonly chain = new PromiseChain();
  private readonly tables: Dictionary<Resource.RawTable<T>> = {};

  private readonly router = express
    .Router()
    .get<
      Request.GetResourceTable<T>['ReqParams'],
      Request.GetResourceTable<T>['ResBody'],
      Request.GetResourceTable<T>['ReqBody'],
      Request.GetResourceTable<T>['ReqQuery']
    >('/api/resource/table/:resource', (req, res, next) =>
      this.chain.push(async () => {
        const { resource } = req.params,
          { hash, limit = 50, resourceId } = req.query;

        const items: T[] = (
          await readFile(`resource/${resource}.items.json`, 'utf-8').then(
            JSON.parse
          )
        ).slice(0, 50); // FIXME;

        const routes: Resource.Routes<T> = await readFile(
          `resource/${resource}.routes.json`,
          'utf-8'
        ).then(JSON.parse);

        const columns: [Path<T>, Resource.TableColumn][] = Object.keys(
          routes
        ).map((path) => [
          path as Path<T>,
          {
            include: req.query.paths.split(',').includes(path),
          },
        ]);

        let table = this.tables[resource];

        if (
          table == null ||
          hash == null ||
          objectHash({ items, routes, columns, limit }) !== hash
        ) {
          const fields = filter(columns, '1.include').map(([path]) => ({
            path,
            type: routes[path]!.type,
          }));

          table = this.tables[resource] = {
            resource,
            rowsPages: paginate(
              items.map((item) => ({
                resource: pick(item, 'id'),
                fields: fields.map(
                  (field): Resource.TableField<T> => ({
                    ...field,
                    id: item.id,
                    value: get(item, field.path),
                  })
                ),
              })),
              +limit
            ),
            hash: objectHash({ items, routes, columns, limit }),
            columns: Object.fromEntries(columns),
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
          pageToken:
            resourceId &&
            table.rowsPages.find((rowsPage) =>
              find(rowsPage.items, { resource: { id: resourceId } })
            )?.pageToken,
          resourceId,
        });
      }, next)
    )
    .get<
      Request.GetResourceTableRowsPage<T>['ReqParams'],
      Request.GetResourceTableRowsPage<T>['ResBody'],
      Request.GetResourceTableRowsPage<T>['ReqBody'],
      Request.GetResourceTableRowsPage<T>['ReqQuery']
    >('/api/resource/table/rows/page/:resource', (req, res, next) =>
      res.send(
        find(this.tables[req.params.resource].rowsPages, {
          pageToken: req.query.pageToken,
        })
      )
    )
    .patch<
      Request.PatchResourceItem<T>['ReqParams'],
      Request.PatchResourceItem<T>['ResBody'],
      Request.PatchResourceItem<T>['ReqBody'],
      Request.PatchResourceItem<T>['ReqQuery']
    >('/api/:resource/item', (req, res, next) =>
      this.chain.push(() => {
        const { resource } = req.params,
          { id, path, value } = req.body;

        const getItem = (items: T[], id: string): T => {
          const item = items.find((item) => item.id === id);

          if (item == null) {
            throw new Error(`${resource} ${JSON.stringify(id)} not found`);
          }

          return item;
        };

        return readFile(`resource/${resource}.items.json`, 'utf-8')
          .then<T[]>(JSON.parse)
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
