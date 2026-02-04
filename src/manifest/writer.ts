import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { ManifestSchema, type Manifest } from './schema.js';
import { logger } from '../utils/logger.js';

/**
 * Write manifest to docs/.manifest.json
 */
export async function writeManifest(
  manifest: Manifest,
  repoRoot: string,
  docsRoot = 'docs'
): Promise<void> {
  const manifestPath = resolve(repoRoot, docsRoot, '.manifest.json');

  // Validate manifest before writing
  try {
    ManifestSchema.parse(manifest);
  } catch (error) {
    logger.error('Invalid manifest data:', error);
    throw new Error(`Cannot write invalid manifest: ${error}`);
  }

  try {
    // Ensure docs directory exists
    await mkdir(dirname(manifestPath), { recursive: true });

    // Write manifest with pretty formatting
    const content = JSON.stringify(manifest, null, 2);
    await writeFile(manifestPath, content, 'utf-8');

    logger.success(`Manifest written to ${manifestPath}`);
  } catch (error) {
    logger.error(`Failed to write manifest to ${manifestPath}:`, error);
    throw error;
  }
}

/**
 * Update last successful run info
 */
export async function updateLastRun(
  repoRoot: string,
  gitCommit: string,
  success: boolean,
  notes?: string,
  docsRoot = 'docs'
): Promise<void> {
  const { readManifest } = await import('./reader.js');
  const manifest = await readManifest(repoRoot, docsRoot);

  if (!manifest) {
    throw new Error('Cannot update run info: manifest does not exist');
  }

  const timestamp = new Date().toISOString();

  // Add to history
  manifest.runs.history.push({
    timestamp,
    gitCommit,
    success,
    notes,
  });

  // Update lastSuccessful if this run was successful
  if (success) {
    manifest.runs.lastSuccessful = {
      timestamp,
      gitCommit,
      notes,
    };
  }

  await writeManifest(manifest, repoRoot, docsRoot);
}

/**
 * Create initial manifest
 */
export async function createManifest(
  repoRoot: string,
  repoInfo: {
    packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
    workspace: 'single' | 'monorepo' | 'unknown';
    languages: string[];
  },
  units: Manifest['units'],
  ignorePatterns: string[],
  docsRoot = 'docs'
): Promise<Manifest> {
  const manifest: Manifest = {
    schemaVersion: 1,
    tool: {
      name: 'docpulse',
      version: '0.1.0', // TODO: Read from package.json
    },
    repo: {
      root: '.',
      detected: {
        packageManager: repoInfo.packageManager,
        workspace: repoInfo.workspace,
        languages: repoInfo.languages,
      },
      ignore: {
        globs: ignorePatterns,
      },
    },
    docLayout: {
      root: docsRoot,
      mustExist: ['docs/index.md', 'docs/architecture', 'docs/how-to'],
      conventionsSource: 'docs/index.md',
    },
    runs: {
      lastSuccessful: null,
      history: [],
    },
    coverageMap: [],
    units,
  };

  await writeManifest(manifest, repoRoot, docsRoot);
  logger.success('Created initial manifest');

  return manifest;
}
