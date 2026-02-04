export {
  getChangedFiles,
  getDiffStats,
  getFileDiff,
  hasUncommittedChanges,
  getCurrentCommit,
  commitExists,
  type DiffResult,
  type DiffHunk,
  type FileDiff,
} from './diff.js';

export {
  getGitState,
  getCurrentBranch,
  isCommitReachable,
  getCommitMessage,
  getCommitTimestamp,
  type GitState,
} from './state.js';

export {
  validateGitRepository,
  validateCommit,
  validateGit,
  type ValidationResult,
} from './validate.js';
