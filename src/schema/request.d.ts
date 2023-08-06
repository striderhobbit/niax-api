import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';
import { Resource } from './resource';

interface RequestHandlerParams {
  ReqParams: ParamsDictionary;
  ResBody: any;
  ReqBody: any;
  ReqQuery: ParsedQs;
}

declare namespace Request {
  interface GetResourceTable<I extends Resource.Item>
    extends RequestHandlerParams {
    ReqParams: {
      resourceName: string;
    };
    ResBody: Resource.Table<I>;
    ReqQuery: {
      hash?: string;
      limit: string;
      paths: string;
      resourceId?: string;
    };
  }

  interface GetResourceTableRowsPage<I extends Resource.Item>
    extends RequestHandlerParams {
    ReqParams: {
      resourceName: string;
    };
    ResBody: Resource.TableRowsPage<I>;
    ReqQuery: {
      pageToken: string;
    };
  }

  interface PatchResourceItem<I extends Resource.Item>
    extends RequestHandlerParams {
    ReqParams: {
      resourceName: string;
    };
    ResBody: I;
    ReqBody: Resource.TableField<I>;
    ReqQuery: Record<string, never>;
  }
}
