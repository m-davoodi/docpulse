export {
  ManifestSchema,
  type Manifest,
  type ManifestUnit,
  type ManifestCoverageEntry,
  type ManifestRun,
} from './schema.js';

export {
  readManifest,
  manifestExists,
  getLastSuccessfulRun,
  getCoverageMap,
} from './reader.js';

export {
  writeManifest,
  updateLastRun,
  createManifest,
} from './writer.js';

export {
  updateCoverageEntry,
  findDocsForFile,
  findFilesForDoc,
  mapFilesToDocs,
  initializeCoverageMap,
} from './coverage.js';
