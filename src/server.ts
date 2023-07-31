import { json } from 'body-parser';
import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { StatusCodes } from 'http-status-codes';
import { Dictionary, find, fromPairs, get, pick, set } from 'lodash';
import morgan from 'morgan';
import objectHash from 'object-hash';
import { paginate } from './paging';
import { Path, UniqItem } from './schema';
import { Request } from './schema/request';
import { Resource } from './schema/resource';

export class Server<T extends UniqItem> {
  private readonly app = express();
  private readonly table: Dictionary<Resource.RawTable<T>> = {};
  private readonly router = express
    .Router()
    .get<
      Request.GetResourceTable<T>['ReqParams'],
      Request.GetResourceTable<T>['ResBody'],
      Request.GetResourceTable<T>['ReqBody'],
      Request.GetResourceTable<T>['ReqQuery']
    >('/api/resource/table/:resource', async (req, res, next) => {
      const { resource } = req.params,
        paths = req.query.paths.split(',').map((path) => path as Path<T>),
        { limit, hash, resourceId } = req.query;

      const items: T[] = (
        await readFile(`resource/${resource}.items.json`, 'utf-8').then(
          JSON.parse
        )
      ).slice(0, 50);

      const routes: Resource.Routes<T> = await readFile(
        `resource/${resource}.routes.json`,
        'utf-8'
      ).then(JSON.parse);

      let table = this.table[resource];

      if (
        table == null ||
        hash == null ||
        objectHash({ items, routes, paths, limit }) !== hash
      ) {
        const fields = paths.map((path) => ({
          path,
          type: routes[path]!.type,
        }));

        table = this.table[resource] = {
          resource,
          rows: paginate(
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
          hash: objectHash({ items, routes, paths, limit }),
          columns: fromPairs(
            Object.keys(routes)
              .map((path) => path as Path<T>)
              .map((path) => [
                path,
                {
                  include: paths.includes(path),
                },
              ])
          ),
        };
      }

      res.send({
        ...table,
        rows: fromPairs(
          table.rows.map(({ items, pageToken }) => [
            pageToken,
            { items: items.map((item) => pick(item, 'resource')) },
          ])
        ),
        pageToken:
          resourceId &&
          table.rows.find((row) =>
            find(row.items, { resource: { id: resourceId } })
          )?.pageToken,
        resourceId,
      });
    })
    .get<
      Request.GetResourceTablePage<T>['ReqParams'],
      Request.GetResourceTablePage<T>['ResBody'],
      Request.GetResourceTablePage<T>['ReqBody'],
      Request.GetResourceTablePage<T>['ReqQuery']
    >('/api/resource/table/page/:resource', (req, res, next) =>
      res.send(
        find(this.table[req.params.resource].rows, {
          pageToken: req.query.pageToken,
        })
      )
    )
    .patch<
      Request.PatchResourceItem<T>['ReqParams'],
      Request.PatchResourceItem<T>['ResBody'],
      Request.PatchResourceItem<T>['ReqBody'],
      Request.PatchResourceItem<T>['ReqQuery']
    >('/api/:resource', (req, res, next) => {
      const { resource } = req.params;

      readFile(`resource/${resource}.items.json`, 'utf-8')
        .then<T[]>(JSON.parse)
        .then((items) => {
          const item = find(items, (item) => item.id === req.body.id);

          if (item == null) {
            throw new Error(`${resource} item ${req.body.id} not found`);
          }

          res.send(set(item, req.body.path, req.body.value));

          delete this.table[resource];

          return items;
        })
        .then((items) =>
          writeFile(
            `resource/${resource}.items.json`,
            JSON.stringify(items, null, '\t')
          )
        );
    });

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
