import { relative } from 'path';
import { logger } from '../utils/logger.js';
import type { RepoInfo, PackageInfo } from './discovery.js';
import { findWorkspacePackages, findEntryPoints } from './discovery.js';

export type UnitKind = 'repo' | 'package' | 'app' | 'lib';

export interface Unit {
  id: string;
  kind: UnitKind;
  path: string;
  relativePath: string;
  name: string;
  doc: string;
  entrypoints: string[];
  packageInfo?: PackageInfo;
}

/**
 * Partition the repository into documentation units
 */
export async function partitionIntoUnits(repoInfo: RepoInfo): Promise<Unit[]> {
  const units: Unit[] = [];

  logger.debug('Partitioning repository into units');

  if (repoInfo.workspaceType === 'monorepo') {
    // For monorepos, create units for each package
    const packages = await findWorkspacePackages(repoInfo.root, repoInfo.packageManager);

    for (const pkg of packages) {
      const relativePath = relative(repoInfo.root, pkg.path);
      const unitKind = determineUnitKind(relativePath);

      // Find entry points for this package
      const entrypoints = await findEntryPoints(pkg.path);

      // Add package.json as an entrypoint
      if (!entrypoints.includes('package.json')) {
        entrypoints.unshift('package.json');
      }

      const unit: Unit = {
        id: pkg.isRoot ? 'root' : sanitizeId(pkg.name),
        kind: pkg.isRoot ? 'repo' : unitKind,
        path: pkg.path,
        relativePath: relativePath || '.',
        name: pkg.name,
        doc: pkg.isRoot ? 'docs/index.md' : determineDocPath(pkg.name, relativePath, unitKind),
        entrypoints,
        packageInfo: pkg,
      };

      units.push(unit);
      logger.debug(`Created unit: ${unit.id} (${unit.kind}) -> ${unit.doc}`);
    }
  } else {
    // For single package repos, create one unit for the root
    const entrypoints = await findEntryPoints(repoInfo.root);
    entrypoints.unshift('package.json');

    const unit: Unit = {
      id: 'root',
      kind: 'repo',
      path: repoInfo.root,
      relativePath: '.',
      name: 'root',
      doc: 'docs/index.md',
      entrypoints,
    };

    units.push(unit);
    logger.debug(`Created single unit: ${unit.id} -> ${unit.doc}`);
  }

  return units;
}

/**
 * Determine the kind of unit based on its path
 */
function determineUnitKind(relativePath: string): UnitKind {
  const normalized = relativePath.toLowerCase();

  if (normalized.startsWith('apps/') || normalized.startsWith('apps\\')) {
    return 'app';
  }

  if (
    normalized.startsWith('libs/') ||
    normalized.startsWith('libs\\') ||
    normalized.startsWith('libraries/')
  ) {
    return 'lib';
  }

  if (normalized.startsWith('packages/') || normalized.startsWith('packages\\')) {
    return 'package';
  }

  return 'package';
}

/**
 * Determine the documentation path for a unit
 */
function determineDocPath(name: string, relativePath: string, kind: UnitKind): string {
  const sanitized = sanitizeId(name);

  if (kind === 'app') {
    return `docs/apps/${sanitized}.md`;
  }

  if (kind === 'lib') {
    return `docs/libs/${sanitized}.md`;
  }

  // Default to packages
  return `docs/packages/${sanitized}.md`;
}

/**
 * Sanitize a name to be used as an ID or filename
 */
function sanitizeId(name: string): string {
  return name
    .replace(/^@/, '') // Remove leading @
    .replace(/\//g, '-') // Replace / with -
    .replace(/[^a-z0-9-]/gi, '-') // Replace other special chars with -
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/^-|-$/g, '') // Remove leading/trailing dashes
    .toLowerCase();
}
