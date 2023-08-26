import { remove } from 'lodash';

interface ItemsCacheConfig<T> {
  limit: number;
  startWith?: T[];
}

export class ItemsCache<T extends { token: string }> {
  private readonly items: T[];

  constructor(private readonly config: ItemsCacheConfig<T>) {
    this.items = config.startWith?.slice(0, config.limit) ?? [];
  }

  public add(item: T): T {
    if (this.tryGetItem(item.token) != null) {
      throw new Error(`duplicate item ${item.token}`);
    }

    this.items.unshift(item);

    this.items.length = Math.min(this.items.length, this.config.limit);

    return item;
  }

  public deleteItem(token: string): T {
    this.getItem(token);

    return remove(this.items, (item) => item.token === token)[0];
  }

  public getItem(token: string): T {
    const item = this.tryGetItem(token);

    if (item == null) {
      throw new Error(`item ${token} not found`);
    }

    return item;
  }

  public getItems(): T[] {
    return this.items.slice();
  }

  public promoteItem(token: string): T {
    this.items.unshift(this.deleteItem(token));

    return this.items[0];
  }

  public tryGetItem(token: string): T | undefined {
    return this.items.find((item) => item.token === token);
  }
}
