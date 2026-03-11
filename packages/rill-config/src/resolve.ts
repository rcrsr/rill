import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { ConfigNotFoundError } from './errors.js';

const CONFIG_FILENAME = 'rill-config.json';

export function resolveConfigPath(options: {
  configFlag?: string;
  cwd: string;
}): string {
  if (options.configFlag !== undefined) {
    const absolute = resolve(options.configFlag);
    if (!existsSync(absolute)) {
      throw new ConfigNotFoundError(`Config not found: ${absolute}`);
    }
    return absolute;
  }

  let current = resolve(options.cwd);
  while (true) {
    const candidate = join(current, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new ConfigNotFoundError(
    `No rill-config.json found from ${options.cwd} to root`
  );
}
