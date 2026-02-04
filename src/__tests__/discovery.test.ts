import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import {
  detectPackageManager,
  detectWorkspaceType,
  detectLanguages,
  findEntryPoints,
  discoverRepository,
} from '../scan/discovery.js';

describe('Repository Discovery', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = resolve(tmpdir(), `docpulse-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('detectPackageManager', () => {
    it('should detect pnpm from lock file', async () => {
      await writeFile(join(testDir, 'pnpm-lock.yaml'), '');
      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('pnpm');
    });

    it('should detect npm from lock file', async () => {
      await writeFile(join(testDir, 'package-lock.json'), '');
      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('npm');
    });

    it('should detect yarn from lock file', async () => {
      await writeFile(join(testDir, 'yarn.lock'), '');
      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('yarn');
    });

    it('should return unknown when no lock file exists', async () => {
      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('unknown');
    });
  });

  describe('detectWorkspaceType', () => {
    it('should detect monorepo from package.json workspaces', async () => {
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      const type = await detectWorkspaceType(testDir, 'npm');
      expect(type).toBe('monorepo');
    });

    it('should detect monorepo from pnpm-workspace.yaml', async () => {
      await writeFile(join(testDir, 'package.json'), JSON.stringify({}));
      await writeFile(join(testDir, 'pnpm-workspace.yaml'), '');
      const type = await detectWorkspaceType(testDir, 'pnpm');
      expect(type).toBe('monorepo');
    });

    it('should detect single package repo', async () => {
      await writeFile(join(testDir, 'package.json'), JSON.stringify({}));
      const type = await detectWorkspaceType(testDir, 'npm');
      expect(type).toBe('single');
    });
  });

  describe('detectLanguages', () => {
    it('should detect TypeScript', async () => {
      await writeFile(join(testDir, 'tsconfig.json'), '{}');
      await writeFile(join(testDir, 'package.json'), '{}');
      const result = await detectLanguages(testDir);
      expect(result.hasTypeScript).toBe(true);
      expect(result.languages).toContain('ts');
    });

    it('should detect JavaScript', async () => {
      await writeFile(join(testDir, 'package.json'), '{}');
      const result = await detectLanguages(testDir);
      expect(result.hasJavaScript).toBe(true);
      expect(result.languages).toContain('js');
    });
  });

  describe('findEntryPoints', () => {
    it('should find common entry points', async () => {
      const srcDir = join(testDir, 'src');
      await mkdir(srcDir);
      await writeFile(join(srcDir, 'index.ts'), '');
      await writeFile(join(srcDir, 'main.js'), '');

      const entryPoints = await findEntryPoints(testDir);
      expect(entryPoints).toContain('src/index.ts');
      expect(entryPoints).toContain('src/main.js');
    });
  });

  describe('discoverRepository', () => {
    it('should discover repository info', async () => {
      await writeFile(join(testDir, 'pnpm-lock.yaml'), '');
      await writeFile(join(testDir, 'package.json'), JSON.stringify({}));
      await writeFile(join(testDir, 'tsconfig.json'), '{}');

      const info = await discoverRepository(testDir);

      expect(info.root).toBe(testDir);
      expect(info.packageManager).toBe('pnpm');
      expect(info.workspaceType).toBe('single');
      expect(info.hasTypeScript).toBe(true);
      expect(info.hasJavaScript).toBe(true);
    });
  });
});
