import { readdir } from 'fs/promises';
import { resolve, join } from 'path';
import { logger } from '../utils/logger.js';
import { parseFile, type ModuleInfo } from './parser.js';
import { resolveImport, loadTsConfig, type ResolverOptions } from './resolver.js';
import { buildDependencyGraph, type DependencyGraph } from './graph.js';
import { shouldIgnore } from '../scan/ignore.js';

export { type DependencyGraph, type ModuleInfo } from './graph.js';
export { computeImpactedClosure, getDependencies, getDependents, exportGraph } from './graph.js';

/**
 * Build a dependency graph for all JavaScript/TypeScript files in a directory
 */
export async function buildGraphForDirectory(
  dirPath: string,
  ignorePatterns: string[] = [],
  repoRoot?: string
): Promise<DependencyGraph> {
  const root = repoRoot || dirPath;
  
  logger.info('Building dependency graph...');

  // Load tsconfig for path resolution
  const resolverOptions = await loadTsConfig(root);

  // Find all JS/TS files
  const files = await findSourceFiles(dirPath, ignorePatterns);
  logger.debug(`Found ${files.length} source files`);

  // Parse all files
  const modules: ModuleInfo[] = [];
  for (const file of files) {
    try {
      const moduleInfo = await parseFile(file);
      modules.push(moduleInfo);
    } catch (error) {
      logger.debug(`Failed to parse ${file}:`, error);
    }
  }

  logger.debug(`Parsed ${modules.length} modules`);

  // Resolve imports
  const resolvedModules: ModuleInfo[] = [];
  for (const module of modules) {
    const resolvedImports = [];

    for (const imp of module.imports) {
      const resolved = await resolveImport(imp.source, module.filePath, resolverOptions);
      
      if (resolved) {
        resolvedImports.push({
          ...imp,
          source: resolved, // Replace source with resolved path
        });
      }
    }

    resolvedModules.push({
      ...module,
      imports: resolvedImports,
    });
  }

  // Build the graph
  const graph = buildDependencyGraph(resolvedModules, root);

  logger.success(`Dependency graph built: ${graph.nodes.size} nodes`);

  return graph;
}

/**
 * Recursively find all source files in a directory
 */
async function findSourceFiles(
  dirPath: string,
  ignorePatterns: string[],
  baseDir?: string
): Promise<string[]> {
  const base = baseDir || dirPath;
  const files: string[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = fullPath.replace(base + '/', '');

      // Check if should be ignored
      if (shouldIgnore(relativePath, ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        const subFiles = await findSourceFiles(fullPath, ignorePatterns, base);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        // Check if it's a source file
        if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to read directory ${dirPath}:`, error);
  }

  return files;
}
