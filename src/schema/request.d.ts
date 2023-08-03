import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';
import { UniqItem } from '.';
import { Resource } from './resource';

interface RequestHandlerParams {
  ReqParams: ParamsDictionary;
  ResBody: any;
  ReqBody: any;
  ReqQuery: ParsedQs;
}

declare namespace Request {
  interface GetResourceTable<T extends UniqItem> extends RequestHandlerParams {
    ReqParams: {
      resource: string;
    };
    ResBody: Resource.TableHeader<T>;
    ReqBody: {};
    ReqQuery: {
      hash?: string;
      limit: string;
      paths: string;
      resourceId?: string;
    };
  }

  interface GetResourceTablePage<T extends UniqItem>
    extends RequestHandlerParams {
    ReqParams: {
      resource: string;
    };
    ResBody: Resource.TableRowsPage<T>;
    ReqBody: {};
    ReqQuery: {
      pageToken: string;
    };
  }

  interface PatchResourceItem<T extends UniqItem> extends RequestHandlerParams {
    ReqParams: {
      resource: string;
    };
    ResBody: T;
    ReqBody: Resource.TableField<T>;
    ReqQuery: {};
  }
}
