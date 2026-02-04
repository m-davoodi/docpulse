import { readFile, access, readdir, stat } from 'fs/promises';
import { resolve, join, dirname } from 'path';
import { logger } from '../utils/logger.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'unknown';
export type WorkspaceType = 'single' | 'monorepo' | 'unknown';

export interface RepoInfo {
  root: string;
  packageManager: PackageManager;
  workspaceType: WorkspaceType;
  languages: string[];
  hasTypeScript: boolean;
  hasJavaScript: boolean;
}

export interface PackageInfo {
  name: string;
  path: string;
  packageJson: Record<string, unknown>;
  isRoot: boolean;
}

/**
 * Detect the package manager used in the repository
 */
export async function detectPackageManager(repoRoot: string): Promise<PackageManager> {
  try {
    // Check for lock files
    const lockFiles = {
      'pnpm-lock.yaml': 'pnpm' as const,
      'yarn.lock': 'yarn' as const,
      'package-lock.json': 'npm' as const,
    };

    for (const [lockFile, pm] of Object.entries(lockFiles)) {
      try {
        await access(resolve(repoRoot, lockFile));
        logger.debug(`Detected package manager: ${pm} (found ${lockFile})`);
        return pm;
      } catch {
        // File doesn't exist, continue
      }
    }

    return 'unknown';
  } catch (error) {
    logger.debug('Failed to detect package manager:', error);
    return 'unknown';
  }
}

/**
 * Detect if this is a single package or monorepo
 */
export async function detectWorkspaceType(
  repoRoot: string,
  packageManager: PackageManager
): Promise<WorkspaceType> {
  try {
    const packageJsonPath = resolve(repoRoot, 'package.json');
    const content = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    // Check for workspace configuration
    if (packageJson.workspaces) {
      logger.debug('Detected monorepo: found workspaces in package.json');
      return 'monorepo';
    }

    // Check for pnpm workspace
    if (packageManager === 'pnpm') {
      try {
        await access(resolve(repoRoot, 'pnpm-workspace.yaml'));
        logger.debug('Detected monorepo: found pnpm-workspace.yaml');
        return 'monorepo';
      } catch {
        // No pnpm workspace file
      }
    }

    // Check for common monorepo directory structures
    const monorepoMarkers = ['packages', 'apps', 'libs'];
    for (const marker of monorepoMarkers) {
      try {
        const markerPath = resolve(repoRoot, marker);
        const stats = await stat(markerPath);
        if (stats.isDirectory()) {
          const entries = await readdir(markerPath);
          // Check if any subdirectories have package.json
          for (const entry of entries) {
            try {
              await access(resolve(markerPath, entry, 'package.json'));
              logger.debug(`Detected monorepo: found package.json in ${marker}/${entry}`);
              return 'monorepo';
            } catch {
              // No package.json in this directory
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return 'single';
  } catch (error) {
    logger.debug('Failed to detect workspace type:', error);
    return 'unknown';
  }
}

/**
 * Detect languages used in the repository
 */
export async function detectLanguages(repoRoot: string): Promise<{
  languages: string[];
  hasTypeScript: boolean;
  hasJavaScript: boolean;
}> {
  const languages = new Set<string>();
  let hasTypeScript = false;
  let hasJavaScript = false;

  try {
    // Check for TypeScript
    try {
      await access(resolve(repoRoot, 'tsconfig.json'));
      languages.add('ts');
      hasTypeScript = true;
      logger.debug('Detected TypeScript: found tsconfig.json');
    } catch {
      // No TypeScript config
    }

    // Check for JavaScript by looking at package.json
    try {
      const packageJsonPath = resolve(repoRoot, 'package.json');
      await access(packageJsonPath);
      languages.add('js');
      hasJavaScript = true;
      logger.debug('Detected JavaScript: found package.json');
    } catch {
      // No package.json
    }

    return {
      languages: Array.from(languages),
      hasTypeScript,
      hasJavaScript,
    };
  } catch (error) {
    logger.debug('Failed to detect languages:', error);
    return {
      languages: [],
      hasTypeScript: false,
      hasJavaScript: false,
    };
  }
}

/**
 * Find entry points in the repository
 */
export async function findEntryPoints(repoRoot: string): Promise<string[]> {
  const entryPoints: string[] = [];
  const commonEntryPoints = [
    'src/index.ts',
    'src/index.js',
    'src/main.ts',
    'src/main.js',
    'index.ts',
    'index.js',
    'app.ts',
    'app.js',
    'server.ts',
    'server.js',
  ];

  for (const entry of commonEntryPoints) {
    try {
      const entryPath = resolve(repoRoot, entry);
      await access(entryPath);
      entryPoints.push(entry);
      logger.debug(`Found entry point: ${entry}`);
    } catch {
      // Entry point doesn't exist
    }
  }

  return entryPoints;
}

/**
 * Find all workspace packages in a monorepo
 */
export async function findWorkspacePackages(
  repoRoot: string,
  packageManager: PackageManager
): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];

  try {
    // Read root package.json
    const rootPackageJsonPath = resolve(repoRoot, 'package.json');
    const rootContent = await readFile(rootPackageJsonPath, 'utf-8');
    const rootPackageJson = JSON.parse(rootContent);

    // Add root package
    packages.push({
      name: rootPackageJson.name || 'root',
      path: repoRoot,
      packageJson: rootPackageJson,
      isRoot: true,
    });

    let workspaceGlobs: string[] = [];

    // Get workspace patterns
    if (rootPackageJson.workspaces) {
      if (Array.isArray(rootPackageJson.workspaces)) {
        workspaceGlobs = rootPackageJson.workspaces;
      } else if (rootPackageJson.workspaces.packages) {
        workspaceGlobs = rootPackageJson.workspaces.packages;
      }
    }

    // For pnpm, also check pnpm-workspace.yaml
    if (packageManager === 'pnpm') {
      try {
        const pnpmWorkspacePath = resolve(repoRoot, 'pnpm-workspace.yaml');
        const pnpmContent = await readFile(pnpmWorkspacePath, 'utf-8');
        // Simple YAML parsing for packages array
        const packagesMatch = pnpmContent.match(/packages:\s*\n((?:\s*-\s*[^\n]+\n)+)/);
        if (packagesMatch) {
          const yamlPackages = packagesMatch[1]
            .split('\n')
            .map((line) => line.trim().replace(/^-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
            .filter(Boolean);
          workspaceGlobs.push(...yamlPackages);
        }
      } catch {
        // No pnpm-workspace.yaml or parsing failed
      }
    }

    // If no workspace globs found, check common directories
    if (workspaceGlobs.length === 0) {
      workspaceGlobs = ['packages/*', 'apps/*', 'libs/*'];
    }

    // Find packages matching the globs (simplified glob matching)
    for (const glob of workspaceGlobs) {
      const parts = glob.split('/');
      if (parts.length === 2 && parts[1] === '*') {
        // Simple case: "packages/*"
        const dir = parts[0];
        try {
          const dirPath = resolve(repoRoot, dir);
          const entries = await readdir(dirPath);

          for (const entry of entries) {
            const packagePath = resolve(dirPath, entry);
            const packageJsonPath = join(packagePath, 'package.json');

            try {
              const stats = await stat(packagePath);
              if (stats.isDirectory()) {
                const content = await readFile(packageJsonPath, 'utf-8');
                const packageJson = JSON.parse(content);

                packages.push({
                  name: packageJson.name || entry,
                  path: packagePath,
                  packageJson,
                  isRoot: false,
                });

                logger.debug(`Found workspace package: ${packageJson.name || entry}`);
              }
            } catch {
              // No package.json in this directory
            }
          }
        } catch {
          // Directory doesn't exist
        }
      }
    }
  } catch (error) {
    logger.debug('Failed to find workspace packages:', error);
  }

  return packages;
}

/**
 * Discover repository information
 */
export async function discoverRepository(repoRoot: string): Promise<RepoInfo> {
  logger.debug(`Discovering repository at ${repoRoot}`);

  const packageManager = await detectPackageManager(repoRoot);
  const workspaceType = await detectWorkspaceType(repoRoot, packageManager);
  const { languages, hasTypeScript, hasJavaScript } = await detectLanguages(repoRoot);

  return {
    root: repoRoot,
    packageManager,
    workspaceType,
    languages,
    hasTypeScript,
    hasJavaScript,
  };
}
