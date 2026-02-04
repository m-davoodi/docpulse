import type { Manifest, ManifestCoverageEntry } from './schema.js';
import { logger } from '../utils/logger.js';
import { shouldIgnore } from '../scan/ignore.js';

/**
 * Update coverage map entry
 */
export function updateCoverageEntry(
  manifest: Manifest,
  docPath: string,
  coveredPatterns: string[]
): void {
  const existingIndex = manifest.coverageMap.findIndex((entry) => entry.doc === docPath);

  const entry: ManifestCoverageEntry = {
    doc: docPath,
    covers: coveredPatterns,
    lastUpdated: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    manifest.coverageMap[existingIndex] = entry;
  } else {
    manifest.coverageMap.push(entry);
  }

  logger.debug(`Updated coverage entry for ${docPath}: ${coveredPatterns.length} patterns`);
}

/**
 * Find which documentation files cover a given source file
 */
export function findDocsForFile(
  filePath: string,
  coverageMap: ManifestCoverageEntry[]
): string[] {
  const docs: string[] = [];

  for (const entry of coverageMap) {
    // Check if file matches any of the patterns
    if (shouldIgnore(filePath, entry.covers)) {
      docs.push(entry.doc);
    }
  }

  return docs;
}

/**
 * Find which source files are covered by a documentation file
 */
export function findFilesForDoc(
  docPath: string,
  coverageMap: ManifestCoverageEntry[]
): string[] {
  const entry = coverageMap.find((e) => e.doc === docPath);
  return entry ? entry.covers : [];
}

/**
 * Map changed files to affected documentation files
 */
export function mapFilesToDocs(
  changedFiles: string[],
  coverageMap: ManifestCoverageEntry[]
): Map<string, string[]> {
  const docToFiles = new Map<string, string[]>();

  for (const file of changedFiles) {
    const docs = findDocsForFile(file, coverageMap);

    for (const doc of docs) {
      if (!docToFiles.has(doc)) {
        docToFiles.set(doc, []);
      }
      docToFiles.get(doc)!.push(file);
    }
  }

  logger.debug(
    `Mapped ${changedFiles.length} changed files to ${docToFiles.size} documentation files`
  );

  return docToFiles;
}

/**
 * Initialize coverage map from units
 */
export function initializeCoverageMap(units: Manifest['units']): ManifestCoverageEntry[] {
  const coverageMap: ManifestCoverageEntry[] = [];

  for (const unit of units) {
    // Create basic coverage for each unit
    const patterns: string[] = [];

    if (unit.kind === 'repo') {
      // Root unit covers everything not covered by other units
      patterns.push('**/*');
    } else {
      // Package/app/lib units cover their own directory
      patterns.push(`${unit.path}/**/*`);
    }

    coverageMap.push({
      doc: unit.doc,
      covers: patterns,
      lastUpdated: new Date().toISOString(),
    });
  }

  return coverageMap;
}
