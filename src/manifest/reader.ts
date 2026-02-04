import { readFile, access } from 'fs/promises';
import { resolve } from 'path';
import { ManifestSchema, type Manifest } from './schema.js';
import { logger } from '../utils/logger.js';

/**
 * Read manifest from docs/.manifest.json
 */
export async function readManifest(repoRoot: string, docsRoot = 'docs'): Promise<Manifest | null> {
  const manifestPath = resolve(repoRoot, docsRoot, '.manifest.json');

  try {
    await access(manifestPath);
  } catch {
    logger.debug(`Manifest not found at ${manifestPath}`);
    return null;
  }

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const rawManifest = JSON.parse(content);
    const manifest = ManifestSchema.parse(rawManifest);

    logger.debug(`Loaded manifest from ${manifestPath}`);
    return manifest;
  } catch (error) {
    logger.error(`Failed to read or parse manifest at ${manifestPath}:`, error);
    throw new Error(`Invalid manifest file: ${error}`);
  }
}

/**
 * Check if manifest exists
 */
export async function manifestExists(repoRoot: string, docsRoot = 'docs'): Promise<boolean> {
  const manifestPath = resolve(repoRoot, docsRoot, '.manifest.json');
  
  try {
    await access(manifestPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the last successful run info from manifest
 */
export async function getLastSuccessfulRun(
  repoRoot: string,
  docsRoot = 'docs'
): Promise<Manifest['runs']['lastSuccessful'] | null> {
  const manifest = await readManifest(repoRoot, docsRoot);
  
  if (!manifest) {
    return null;
  }

  return manifest.runs.lastSuccessful || null;
}

/**
 * Get coverage map from manifest
 */
export async function getCoverageMap(
  repoRoot: string,
  docsRoot = 'docs'
): Promise<Manifest['coverageMap']> {
  const manifest = await readManifest(repoRoot, docsRoot);
  
  if (!manifest) {
    return [];
  }

  return manifest.coverageMap;
}
