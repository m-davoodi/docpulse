import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';

export interface IgnoreRules {
  patterns: string[];
  gitignorePatterns: string[];
}

/**
 * Default ignore patterns that should always be excluded
 */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'out/**',
  'coverage/**',
  '.next/**',
  '.nuxt/**',
  '.cache/**',
  '.turbo/**',
  '.vercel/**',
  '.netlify/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
];

/**
 * Parse .gitignore file and extract patterns
 */
export async function parseGitignore(repoRoot: string): Promise<string[]> {
  const patterns: string[] = [];

  try {
    const gitignorePath = resolve(repoRoot, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Convert gitignore patterns to glob patterns
      let pattern = trimmed;

      // If pattern starts with /, it's relative to root
      if (pattern.startsWith('/')) {
        pattern = pattern.slice(1);
      }

      // If pattern doesn't have /, it matches anywhere
      if (!pattern.includes('/')) {
        pattern = `**/${pattern}`;
      }

      // If pattern is a directory (ends with /), match contents
      if (pattern.endsWith('/')) {
        pattern = `${pattern}**`;
      }

      // If pattern doesn't have **, add it for recursive matching
      if (!pattern.includes('**') && !pattern.endsWith('*')) {
        pattern = `${pattern}/**`;
      }

      patterns.push(pattern);
    }

    logger.debug(`Loaded ${patterns.length} patterns from .gitignore`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.debug('Failed to read .gitignore:', error);
    }
  }

  return patterns;
}

/**
 * Load ignore rules from .gitignore, config, and defaults
 */
export async function loadIgnoreRules(
  repoRoot: string,
  configIgnore: string[] = []
): Promise<IgnoreRules> {
  const gitignorePatterns = await parseGitignore(repoRoot);

  // Combine all patterns, removing duplicates
  const allPatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...gitignorePatterns,
    ...configIgnore,
  ];

  const uniquePatterns = Array.from(new Set(allPatterns));

  logger.debug(`Total ignore patterns: ${uniquePatterns.length}`);

  return {
    patterns: uniquePatterns,
    gitignorePatterns,
  };
}

/**
 * Check if a file path should be ignored based on patterns
 * Simple glob matching implementation
 */
export function shouldIgnore(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchGlob(filePath, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple glob pattern matching
 * Supports: *, **, ?
 */
function matchGlob(str: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedStr = str.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Escape special regex characters except glob wildcards
  let regexPattern = normalizedPattern
    .replace(/[.+^${}()|[\]]/g, '\\$&') // Escape regex special chars
    .replace(/\*\*/g, '\x00') // Temporarily replace ** with null char
    .replace(/\*/g, '[^/]*') // * matches anything except /
    .replace(/\?/g, '[^/]') // ? matches single char except /
    .replace(/\x00/g, '.*'); // ** matches anything including /

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedStr);
}
