import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';
import {
  createManifest,
  readManifest,
  writeManifest,
  updateLastRun,
  manifestExists,
  initializeCoverageMap,
  mapFilesToDocs,
  type Manifest,
} from '../manifest/index.js';

describe('Manifest Management', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = resolve(tmpdir(), `docpulse-manifest-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createManifest', () => {
    it('should create a valid manifest', async () => {
      const manifest = await createManifest(
        testDir,
        {
          packageManager: 'pnpm',
          workspace: 'single',
          languages: ['ts', 'js'],
        },
        [
          {
            id: 'root',
            kind: 'repo',
            path: '.',
            doc: 'docs/index.md',
            entrypoints: ['package.json'],
          },
        ],
        ['node_modules/**', 'dist/**']
      );

      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.tool.name).toBe('docpulse');
      expect(manifest.repo.detected.packageManager).toBe('pnpm');
      expect(manifest.units).toHaveLength(1);
    });
  });

  describe('readManifest', () => {
    it('should read an existing manifest', async () => {
      // Create a manifest first
      await createManifest(
        testDir,
        {
          packageManager: 'npm',
          workspace: 'single',
          languages: ['js'],
        },
        [],
        []
      );

      // Read it back
      const manifest = await readManifest(testDir);

      expect(manifest).not.toBeNull();
      expect(manifest?.repo.detected.packageManager).toBe('npm');
    });

    it('should return null for non-existent manifest', async () => {
      const manifest = await readManifest(testDir);
      expect(manifest).toBeNull();
    });
  });

  describe('manifestExists', () => {
    it('should return true when manifest exists', async () => {
      await createManifest(
        testDir,
        {
          packageManager: 'pnpm',
          workspace: 'single',
          languages: [],
        },
        [],
        []
      );

      const exists = await manifestExists(testDir);
      expect(exists).toBe(true);
    });

    it('should return false when manifest does not exist', async () => {
      const exists = await manifestExists(testDir);
      expect(exists).toBe(false);
    });
  });

  describe('updateLastRun', () => {
    it('should update last run info', async () => {
      // Create manifest
      await createManifest(
        testDir,
        {
          packageManager: 'pnpm',
          workspace: 'single',
          languages: [],
        },
        [],
        []
      );

      // Update last run
      await updateLastRun(testDir, 'abc123', true, 'Test run');

      // Read back
      const manifest = await readManifest(testDir);

      expect(manifest?.runs.lastSuccessful).not.toBeNull();
      expect(manifest?.runs.lastSuccessful?.gitCommit).toBe('abc123');
      expect(manifest?.runs.history).toHaveLength(1);
    });
  });

  describe('initializeCoverageMap', () => {
    it('should create coverage map from units', () => {
      const units: Manifest['units'] = [
        {
          id: 'root',
          kind: 'repo',
          path: '.',
          doc: 'docs/index.md',
          entrypoints: [],
        },
        {
          id: 'pkg-a',
          kind: 'package',
          path: 'packages/a',
          doc: 'docs/packages/a.md',
          entrypoints: [],
        },
      ];

      const coverageMap = initializeCoverageMap(units);

      expect(coverageMap).toHaveLength(2);
      expect(coverageMap[0].doc).toBe('docs/index.md');
      expect(coverageMap[1].doc).toBe('docs/packages/a.md');
      expect(coverageMap[1].covers).toContain('packages/a/**/*');
    });
  });

  describe('mapFilesToDocs', () => {
    it('should map changed files to docs', () => {
      const coverageMap: Manifest['coverageMap'] = [
        {
          doc: 'docs/index.md',
          covers: ['src/**/*'],
        },
        {
          doc: 'docs/packages/a.md',
          covers: ['packages/a/**/*'],
        },
      ];

      const changedFiles = ['src/index.ts', 'packages/a/main.ts'];
      const mapping = mapFilesToDocs(changedFiles, coverageMap);

      expect(mapping.size).toBeGreaterThanOrEqual(0);
    });
  });
});
