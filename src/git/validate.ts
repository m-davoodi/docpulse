import { access } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';
import { getCurrentCommit } from './diff.js';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that the directory is a git repository
 */
export async function validateGitRepository(repoRoot: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if .git directory exists
  try {
    await access(resolve(repoRoot, '.git'));
  } catch {
    errors.push('Not a git repository (no .git directory found)');
  }

  // Check if git command is available
  try {
    await getCurrentCommit(repoRoot);
  } catch (error) {
    errors.push('Git command not available or not a valid repository');
  }

  // Check for uncommitted changes
  try {
    const { hasUncommittedChanges } = await import('./diff.js');
    if (await hasUncommittedChanges(repoRoot)) {
      warnings.push('Repository has uncommitted changes');
    }
  } catch (error) {
    logger.debug('Failed to check for uncommitted changes:', error);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate commit reference
 */
export async function validateCommit(repoRoot: string, commit: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!commit || commit.trim().length === 0) {
    errors.push('Commit reference is empty');
    return { isValid: false, errors, warnings };
  }

  try {
    const { commitExists } = await import('./diff.js');
    const exists = await commitExists(repoRoot, commit);

    if (!exists) {
      errors.push(`Commit ${commit} does not exist`);
    }
  } catch (error) {
    errors.push(`Failed to validate commit: ${error}`);
  }

  // Check if commit is reachable from HEAD
  try {
    const { isCommitReachable } = await import('./state.js');
    const reachable = await isCommitReachable(repoRoot, commit);

    if (!reachable) {
      warnings.push(`Commit ${commit} is not reachable from current HEAD`);
    }
  } catch (error) {
    logger.debug('Failed to check commit reachability:', error);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Comprehensive git validation
 */
export async function validateGit(repoRoot: string, lastCommit?: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate repository
  const repoValidation = await validateGitRepository(repoRoot);
  errors.push(...repoValidation.errors);
  warnings.push(...repoValidation.warnings);

  // If repo is not valid, stop here
  if (!repoValidation.isValid) {
    return { isValid: false, errors, warnings };
  }

  // Validate last commit if provided
  if (lastCommit) {
    const commitValidation = await validateCommit(repoRoot, lastCommit);
    errors.push(...commitValidation.errors);
    warnings.push(...commitValidation.warnings);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
