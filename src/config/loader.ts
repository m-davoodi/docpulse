import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { ConfigSchema, type Config } from './schema.js';
import { logger } from '../utils/logger.js';

export async function loadConfig(cwd: string): Promise<Config> {
  const configPath = resolve(cwd, 'docpulse.config.json');

  try {
    const content = await readFile(configPath, 'utf-8');
    const rawConfig = JSON.parse(content);

    // Substitute environment variables
    const processedConfig = substituteEnvVars(rawConfig);

    const config = ConfigSchema.parse(processedConfig);
    logger.debug(`Loaded config from ${configPath}`);
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug('No config file found, using defaults');
      return ConfigSchema.parse({});
    }
    throw error;
  }
}

function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Replace ${VAR_NAME} with environment variable
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }

  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, substituteEnvVars(value)])
    );
  }

  return obj;
}
