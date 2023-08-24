import { exec, ExecException } from 'child_process';
import { access, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import objectHash from 'object-hash';
import { join } from 'path';
import { ResourceService } from './resource';

interface CompilerVersion {
  tsNode: string;
  node: string;
  compiler: string;
}

export const checkTypes = async (resourceName: string): Promise<string> => {
  const resource = new ResourceService(resourceName);
  const bundle = await resource.getBundle();

  const bundleHash = objectHash(bundle);
  const versionHash = objectHash(await getCompilerVersion());

  const rootDir = `resource/.cache/${versionHash}`;

  try {
    await access(rootDir);
  } catch (error) {
    await mkdir(rootDir, { recursive: true });
  }

  const logFile = join(rootDir, `${bundleHash}.log`);

  try {
    await access(logFile);
  } catch (error) {
    const bundleFile = join(rootDir, `~${bundleHash}.bundle.ts`);

    await writeFile(bundleFile, bundle)
      .then(() => compile(bundleFile))
      .then((errors) => writeFile(logFile, errors))
      .then(() => unlink(bundleFile));
  }

  return readFile(logFile, 'utf-8');
};

const compile = (path: string): Promise<string> =>
  new Promise((resolve, reject) =>
    exec(
      `ts-node ${path}`,
      (error: ExecException | null, stdout: string, stderr: string) =>
        resolve(stderr)
    )
  );

const getCompilerVersion = (): Promise<CompilerVersion> =>
  new Promise<string>((resolve, reject) =>
    exec(
      `ts-node -vv`,
      (error: ExecException | null, stdout: string, stderr: string) =>
        error ? reject(stderr) : resolve(stdout)
    )
  ).then((version) => {
    const pick = (all: string, single: string) =>
      all
        .match(new RegExp(`^${single}\\b(?<version>.*)$`, 'm'))!
        .groups!['version'].trim();

    return {
      tsNode: pick(version, 'ts-node'),
      node: pick(version, 'node'),
      compiler: pick(version, 'compiler'),
    };
  });
