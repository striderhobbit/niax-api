import { configDotenv } from "dotenv";
import { readFile, writeFile } from 'fs/promises';
import { Resource } from './schema/resource';
import { Server } from './server';

function startServer<I extends Resource.Item>(
  backupFile: string
): Promise<Server<I>> {
  let server: Server<I>;

  process.once('SIGUSR2', async (signal) => {
    await writeFile(backupFile, JSON.stringify(server.tableCache.getItems()));

    process.kill(process.pid, signal);
  });

  return readFile(backupFile, 'utf-8')
    .then<Resource.Table<I>[]>(JSON.parse)
    .then(
      (tables) =>
        (server = new Server<I>({
          port: 3000,
          webSocketPort: 8080,
          restoreTables: tables,
        }))
    );
}

configDotenv();

startServer('src/~backup.json');
