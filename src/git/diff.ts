import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export interface DiffResult {
  changedFiles: string[];
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

/**
 * Get list of changed files between two commits
 */
export async function getChangedFiles(
  repoRoot: string,
  fromCommit: string,
  toCommit = 'HEAD'
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`git diff --name-only ${fromCommit}..${toCommit}`, {
      cwd: repoRoot,
    });

    const files = stdout
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    logger.debug(`Found ${files.length} changed files between ${fromCommit}..${toCommit}`);

    return files;
  } catch (error) {
    logger.error('Failed to get changed files:', error);
    return [];
  }
}

/**
 * Get diff statistics between two commits
 */
export async function getDiffStats(
  repoRoot: string,
  fromCommit: string,
  toCommit = 'HEAD'
): Promise<DiffResult> {
  try {
    // Get changed files
    const changedFiles = await getChangedFiles(repoRoot, fromCommit, toCommit);

    // Get diff stats
    const { stdout } = await execAsync(`git diff --shortstat ${fromCommit}..${toCommit}`, {
      cwd: repoRoot,
    });

    // Parse shortstat output: "X files changed, Y insertions(+), Z deletions(-)"
    const insertionsMatch = stdout.match(/(\d+) insertion/);
    const deletionsMatch = stdout.match(/(\d+) deletion/);

    const additions = insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0;
    const deletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0;

    return {
      changedFiles,
      additions,
      deletions,
    };
  } catch (error) {
    logger.error('Failed to get diff stats:', error);
    return {
      changedFiles: [],
      additions: 0,
      deletions: 0,
    };
  }
}

/**
 * Get detailed diff with hunks for specific files
 */
export async function getFileDiff(
  repoRoot: string,
  filePath: string,
  fromCommit: string,
  toCommit = 'HEAD'
): Promise<FileDiff | null> {
  try {
    const { stdout } = await execAsync(`git diff -U3 ${fromCommit}..${toCommit} -- "${filePath}"`, {
      cwd: repoRoot,
    });

    if (!stdout.trim()) {
      return null;
    }

    const hunks = parseDiffHunks(stdout);

    // Count additions and deletions
    let additions = 0;
    let deletions = 0;

    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
        }
      }
    }

    return {
      path: filePath,
      hunks,
      additions,
      deletions,
    };
  } catch (error) {
    logger.debug(`Failed to get diff for ${filePath}:`, error);
    return null;
  }
}

/**
 * Get detailed diffs for multiple files
 */
export async function getFileDiffs(
  repoRoot: string,
  fromCommit: string,
  filePaths: string[],
  toCommit = 'HEAD'
): Promise<FileDiff[]> {
  logger.debug(`Getting diffs for ${filePaths.length} files`);

  const diffs: FileDiff[] = [];

  // Process files in batches to avoid overwhelming the system
  const batchSize = 10;
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(filePath => getFileDiff(repoRoot, filePath, fromCommit, toCommit))
    );

    // Filter out null results and add to diffs array
    for (const result of batchResults) {
      if (result !== null) {
        diffs.push(result);
      }
    }
  }

  logger.debug(`Retrieved ${diffs.length} diffs out of ${filePaths.length} files`);
  return diffs;
}

/**
 * Parse diff output into hunks
 */
function parseDiffHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split('\n');

  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // Match hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

    if (hunkMatch) {
      // Save previous hunk
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      // Start new hunk
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
    } else if (currentHunk && !line.startsWith('---') && !line.startsWith('+++')) {
      // Add line to current hunk (skip file headers)
      currentHunk.lines.push(line);
    }
  }

  // Add last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd: repoRoot,
    });

    return stdout.trim().length > 0;
  } catch (error) {
    logger.debug('Failed to check uncommitted changes:', error);
    return false;
  }
}

/**
 * Get the current commit hash
 */
export async function getCurrentCommit(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', {
      cwd: repoRoot,
    });

    return stdout.trim();
  } catch (error) {
    logger.error('Failed to get current commit:', error);
    throw new Error('Not a git repository or git not available');
  }
}

/**
 * Check if a commit exists
 */
export async function commitExists(repoRoot: string, commit: string): Promise<boolean> {
  try {
    await execAsync(`git cat-file -e ${commit}^{commit}`, {
      cwd: repoRoot,
    });
    return true;
  } catch {
    return false;
  }
}
