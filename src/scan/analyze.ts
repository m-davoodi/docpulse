import { readFile, readdir, stat, access } from 'fs/promises';
import { resolve, join } from 'path';
import { logger } from '../utils/logger.js';
import type { RepoInfo } from './discovery.js';
import type { Unit, UnitKind } from './units.js';

export interface ProjectAnalysis {
  repoInfo: RepoInfo;
  unitsSummary: {
    count: number;
    types: Record<UnitKind, number>;
    names: string[];
  };
  readme: {
    exists: boolean;
    content: string | null;
    fullSize: number;
  };
  packageJson: Record<string, unknown>;
  topLevelStructure: {
    folders: string[];
    files: string[];
  };
  sourceFileTree: string[];
  markdownFiles: Array<{
    path: string;
    size: number;
  }>;
  hasCI: boolean;
  hasTests: boolean;
  hasPublishConfig: boolean;
}

/**
 * Analyze project structure for documentation planning
 */
export async function analyzeProject(
  cwd: string,
  repoInfo: RepoInfo,
  units: Unit[]
): Promise<ProjectAnalysis> {
  logger.debug('Analyzing project structure...');

  // Analyze units
  const unitsSummary = analyzeUnits(units);

  // Read README
  const readme = await readReadme(cwd);

  // Read package.json
  const packageJson = await readPackageJson(cwd);

  // Get top-level structure
  const topLevelStructure = await getTopLevelStructure(cwd);

  // Find markdown files
  const markdownFiles = await findMarkdownFiles(cwd);

  // Detect CI
  const hasCI = await detectCI(cwd);

  // Detect tests
  const hasTests = await detectTests(cwd, packageJson);

  // Check if publishable
  const hasPublishConfig = checkPublishable(packageJson);

  // Get source file tree for LLM context
  const sourceFileTree = await getSourceFileTree(cwd, topLevelStructure.folders);

  return {
    repoInfo,
    unitsSummary,
    readme,
    packageJson,
    topLevelStructure,
    sourceFileTree,
    markdownFiles,
    hasCI,
    hasTests,
    hasPublishConfig,
  };
}

/**
 * Analyze units and create summary
 */
function analyzeUnits(units: Unit[]): ProjectAnalysis['unitsSummary'] {
  const types: Record<UnitKind, number> = {
    repo: 0,
    package: 0,
    app: 0,
    lib: 0,
  };

  const names: string[] = [];

  for (const unit of units) {
    types[unit.kind]++;
    if (unit.kind !== 'repo') {
      names.push(unit.name);
    }
  }

  return {
    count: units.length,
    types,
    names,
  };
}

/**
 * Read README with size limit
 */
async function readReadme(cwd: string): Promise<ProjectAnalysis['readme']> {
  const readmePaths = ['README.md', 'readme.md', 'Readme.md'];

  for (const readmePath of readmePaths) {
    try {
      const fullPath = resolve(cwd, readmePath);
      const stats = await stat(fullPath);
      const fullSize = stats.size;

      // Read up to 3000 chars to avoid context explosion
      const MAX_README_CHARS = 3000;
      const content = await readFile(fullPath, 'utf-8');
      const truncated = content.slice(0, MAX_README_CHARS);

      logger.debug(`Found README at ${readmePath} (${fullSize} bytes, using ${truncated.length} chars)`);

      return {
        exists: true,
        content: truncated,
        fullSize,
      };
    } catch {
      // File doesn't exist, try next
    }
  }

  return {
    exists: false,
    content: null,
    fullSize: 0,
  };
}

/**
 * Read package.json
 */
async function readPackageJson(cwd: string): Promise<Record<string, unknown>> {
  try {
    const packageJsonPath = resolve(cwd, 'package.json');
    const content = await readFile(packageJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.debug('Failed to read package.json:', error);
    return {};
  }
}

/**
 * Get top-level folder and file structure
 */
async function getTopLevelStructure(cwd: string): Promise<{
  folders: string[];
  files: string[];
}> {
  const folders: string[] = [];
  const files: string[] = [];

  try {
    const entries = await readdir(cwd);

    for (const entry of entries) {
      // Skip hidden files and common ignores
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') {
        continue;
      }

      try {
        const entryPath = resolve(cwd, entry);
        const stats = await stat(entryPath);

        if (stats.isDirectory()) {
          folders.push(entry);
        } else {
          files.push(entry);
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    folders.sort();
    files.sort();
  } catch (error) {
    logger.debug('Failed to read top-level structure:', error);
  }

  return { folders, files };
}

/**
 * Get source file tree recursively for LLM context
 * This helps the LLM know exactly what files exist when requesting context
 */
async function getSourceFileTree(
  cwd: string,
  topLevelFolders: string[]
): Promise<string[]> {
  const sourceFiles: string[] = [];

  // Prioritize common source directories
  const sourceDirs = ['src', 'lib', 'packages', 'apps', 'components', 'utils'];
  const dirsToScan = topLevelFolders.filter(
    (folder) =>
      sourceDirs.includes(folder) ||
      folder.endsWith('-src') ||
      folder.startsWith('src-')
  );

  // Limit total files to avoid context explosion
  const MAX_FILES = 200;

  for (const dir of dirsToScan) {
    if (sourceFiles.length >= MAX_FILES) break;

    const dirPath = resolve(cwd, dir);
    await collectFilesRecursively(dirPath, dir, sourceFiles, MAX_FILES);
  }

  sourceFiles.sort();
  logger.debug(`Collected ${sourceFiles.length} source files for LLM context`);

  return sourceFiles;
}

/**
 * Recursively collect files from a directory
 */
async function collectFilesRecursively(
  dirPath: string,
  relativePath: string,
  files: string[],
  maxFiles: number
): Promise<void> {
  if (files.length >= maxFiles) return;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      // Skip hidden files, node_modules, dist, and test files
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === 'coverage'
      ) {
        continue;
      }

      const entryRelativePath = join(relativePath, entry.name);

      if (entry.isDirectory()) {
        // Skip __tests__ and similar test directories for cleaner output
        if (entry.name === '__tests__' || entry.name === '__mocks__') {
          // Still include them but don't recurse deeply
          files.push(`${entryRelativePath}/`);
          continue;
        }
        await collectFilesRecursively(
          resolve(dirPath, entry.name),
          entryRelativePath,
          files,
          maxFiles
        );
      } else {
        // Only include code files
        const codeExtensions = [
          '.ts',
          '.tsx',
          '.js',
          '.jsx',
          '.mjs',
          '.cjs',
          '.vue',
          '.svelte',
          '.py',
          '.go',
          '.rs',
          '.java',
          '.kt',
          '.rb',
          '.php',
        ];
        if (codeExtensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(entryRelativePath);
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to read directory ${dirPath}:`, error);
  }
}

/**
 * Find markdown files in the repository
 */
async function findMarkdownFiles(cwd: string): Promise<Array<{ path: string; size: number }>> {
  const markdownFiles: Array<{ path: string; size: number }> = [];

  const commonDocs = [
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'HISTORY.md',
    'LICENSE.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
  ];

  for (const docFile of commonDocs) {
    try {
      const fullPath = resolve(cwd, docFile);
      const stats = await stat(fullPath);
      markdownFiles.push({
        path: docFile,
        size: stats.size,
      });
      logger.debug(`Found markdown file: ${docFile} (${stats.size} bytes)`);
    } catch {
      // File doesn't exist
    }
  }

  return markdownFiles;
}

/**
 * Detect CI configuration
 */
async function detectCI(cwd: string): Promise<boolean> {
  const ciPaths = [
    '.github/workflows',
    '.gitlab-ci.yml',
    '.circleci/config.yml',
    'azure-pipelines.yml',
    '.travis.yml',
    'Jenkinsfile',
  ];

  for (const ciPath of ciPaths) {
    try {
      await access(resolve(cwd, ciPath));
      logger.debug(`Detected CI: ${ciPath}`);
      return true;
    } catch {
      // Path doesn't exist
    }
  }

  return false;
}

/**
 * Detect test setup
 */
async function detectTests(
  cwd: string,
  packageJson: Record<string, unknown>
): Promise<boolean> {
  // Check for test configs
  const testConfigs = [
    'vitest.config.ts',
    'vitest.config.js',
    'jest.config.ts',
    'jest.config.js',
    'test/setup.ts',
    'tests/setup.ts',
  ];

  for (const config of testConfigs) {
    try {
      await access(resolve(cwd, config));
      logger.debug(`Detected test config: ${config}`);
      return true;
    } catch {
      // Config doesn't exist
    }
  }

  // Check for test script in package.json
  if (packageJson.scripts && typeof packageJson.scripts === 'object') {
    const scripts = packageJson.scripts as Record<string, string>;
    if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
      logger.debug('Detected test script in package.json');
      return true;
    }
  }

  return false;
}

/**
 * Check if package is publishable
 */
function checkPublishable(packageJson: Record<string, unknown>): boolean {
  // Check for publish config
  if (packageJson.publishConfig) {
    return true;
  }

  // Check for files field (indicates preparation for publishing)
  if (packageJson.files) {
    return true;
  }

  // Check if private is explicitly false
  if (packageJson.private === false) {
    return true;
  }

  // Check if it's a library (has main/module/exports)
  if (packageJson.main || packageJson.module || packageJson.exports) {
    return true;
  }

  return false;
}
