import { logger } from '../utils/logger.js';
import { getCurrentCommit, commitExists } from './diff.js';

export interface GitState {
  currentCommit: string;
  currentBranch: string;
  isClean: boolean;
}

/**
 * Get current git state
 */
export async function getGitState(repoRoot: string): Promise<GitState> {
  const currentCommit = await getCurrentCommit(repoRoot);
  const currentBranch = await getCurrentBranch(repoRoot);
  const isClean = !(await hasUncommittedChanges(repoRoot));

  return {
    currentCommit,
    currentBranch,
    isClean,
  };
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(repoRoot: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoRoot,
    });

    return stdout.trim();
  } catch (error) {
    logger.debug('Failed to get current branch:', error);
    return 'unknown';
  }
}

/**
 * Check if there are uncommitted changes
 */
async function hasUncommittedChanges(repoRoot: string): Promise<boolean> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

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
 * Validate that a commit is reachable from current HEAD
 */
export async function isCommitReachable(repoRoot: string, commit: string): Promise<boolean> {
  try {
    // Check if commit exists
    if (!(await commitExists(repoRoot, commit))) {
      return false;
    }

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Check if commit is an ancestor of HEAD
    await execAsync(`git merge-base --is-ancestor ${commit} HEAD`, {
      cwd: repoRoot,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Get commit message
 */
export async function getCommitMessage(repoRoot: string, commit: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(`git log -1 --format=%B ${commit}`, {
      cwd: repoRoot,
    });

    return stdout.trim();
  } catch (error) {
    logger.debug(`Failed to get commit message for ${commit}:`, error);
    return '';
  }
}

/**
 * Get commit timestamp
 */
export async function getCommitTimestamp(repoRoot: string, commit: string): Promise<Date | null> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(`git log -1 --format=%ct ${commit}`, {
      cwd: repoRoot,
    });

    const timestamp = parseInt(stdout.trim(), 10);
    return new Date(timestamp * 1000);
  } catch (error) {
    logger.debug(`Failed to get commit timestamp for ${commit}:`, error);
    return null;
  }
}
