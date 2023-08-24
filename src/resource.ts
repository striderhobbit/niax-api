import { readFile, writeFile } from 'fs/promises';
import { Resource } from './schema/resource';

export class ResourceService<I extends Resource.Item> {
  constructor(public readonly name: string, public readonly id?: string) {}

  public findItemIn(items: I[]): I {
    const item = items.find((item) => item.id === this.id);

    if (item == null) {
      throw new Error(`${this.name} ${this.id} not found`);
    }

    return item;
  }

  public async getBundle(): Promise<string> {
    return [
      'import { Resource } from "../../../src/schema/resource";',
      await this.getSchema(),
      `const routes: Resource.Route<I>[] = ${JSON.stringify(
        await this.getRoutes(),
        null,
        '\t'
      )};`,
      `const items: I[] = ${JSON.stringify(await this.getItems())};`,
    ].join('\n\n');
  }

  public getItems(): Promise<I[]> {
    return readFile(`resource/items/${this.name}.json`, 'utf-8').then<I[]>(
      JSON.parse
    );
  }

  public getRoutes(): Promise<Resource.Route<I>[]> {
    return readFile(`resource/routes/${this.name}.json`, 'utf-8').then<
      Resource.Route<I>[]
    >(JSON.parse);
  }

  public getSchema(): Promise<string> {
    return readFile(`resource/schema/${this.name}.d.ts`, 'utf-8');
  }

  public async setItems(items: I[]): Promise<I[]> {
    await writeFile(
      `resource/items/${this.name}.json`,
      JSON.stringify(items, null, '\t')
    );

    return items;
  }
}
