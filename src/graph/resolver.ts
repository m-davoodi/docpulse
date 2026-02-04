import { resolve, dirname, extname, join } from 'path';
import { stat, access, readFile } from 'fs/promises';
import { logger } from '../utils/logger.js';

export interface ResolverOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  extensions?: string[];
}

/**
 * Resolve an import path to an absolute file path
 */
export async function resolveImport(
  importPath: string,
  fromFile: string,
  options: ResolverOptions = {}
): Promise<string | null> {
  const { extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] } = options;

  // Skip external modules (not starting with ./ or ../ or /)
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    // Check if it's a path alias
    if (options.paths) {
      const resolved = await resolvePathAlias(importPath, fromFile, options);
      if (resolved) {
        return resolved;
      }
    }

    // External module, skip
    logger.debug(`Skipping external module: ${importPath}`);
    return null;
  }

  const fromDir = dirname(fromFile);
  const basePath = resolve(fromDir, importPath);

  // Try with exact path
  try {
    const stats = await stat(basePath);
    if (stats.isFile()) {
      return basePath;
    }

    // If it's a directory, try index files
    if (stats.isDirectory()) {
      for (const ext of extensions) {
        const indexPath = join(basePath, `index${ext}`);
        try {
          await access(indexPath);
          return indexPath;
        } catch {
          // Try next extension
        }
      }
    }
  } catch {
    // File doesn't exist, try with extensions
  }

  // Try adding extensions
  for (const ext of extensions) {
    // Skip if already has this extension
    if (extname(basePath) === ext) {
      continue;
    }

    const withExt = `${basePath}${ext}`;
    try {
      await access(withExt);
      return withExt;
    } catch {
      // Try next extension
    }
  }

  logger.debug(`Could not resolve: ${importPath} from ${fromFile}`);
  return null;
}

/**
 * Resolve path aliases from tsconfig paths
 */
async function resolvePathAlias(
  importPath: string,
  fromFile: string,
  options: ResolverOptions
): Promise<string | null> {
  if (!options.paths || !options.baseUrl) {
    return null;
  }

  // Find matching path alias
  for (const [pattern, mappings] of Object.entries(options.paths)) {
    // Simple pattern matching (support * wildcard)
    const regex = new RegExp('^' + pattern.replace('*', '(.*)') + '$');
    const match = importPath.match(regex);

    if (match) {
      const captured = match[1] || '';

      // Try each mapping
      for (const mapping of mappings) {
        const resolvedPath = mapping.replace('*', captured);
        const fullPath = resolve(options.baseUrl!, resolvedPath);

        // Try to resolve this path
        const resolved = await resolveImport(fullPath, fromFile, {
          ...options,
          paths: undefined, // Prevent infinite recursion
        });

        if (resolved) {
          return resolved;
        }
      }
    }
  }

  return null;
}

/**
 * Load tsconfig.json and extract compiler options for path resolution
 */
export async function loadTsConfig(repoRoot: string): Promise<ResolverOptions> {
  try {
    const tsconfigPath = resolve(repoRoot, 'tsconfig.json');
    const content = await readFile(tsconfigPath, 'utf-8');
    
    // Remove comments from JSON (simple approach)
    const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const tsconfig = JSON.parse(cleanContent);

    const compilerOptions = tsconfig.compilerOptions || {};

    return {
      baseUrl: compilerOptions.baseUrl ? resolve(repoRoot, compilerOptions.baseUrl) : repoRoot,
      paths: compilerOptions.paths || {},
    };
  } catch (error) {
    logger.debug('Could not load tsconfig.json:', error);
    return {};
  }
}
