import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';
import { readManifest, getLastSuccessfulRun } from '../manifest/index.js';
import { getGitState, getCommitMessage, getCommitTimestamp } from '../git/index.js';

export function createStatusCommand() {
  return new Command('status')
    .description('Show documentation status and last run information')
    .action(async () => {
      try {
        const cwd = process.cwd();
        const config = await loadConfig(cwd);

        logger.info('Documentation Status');
        logger.info('===================\n');

        // Load manifest
        const manifest = await readManifest(cwd, config.docs.root);
        if (!manifest) {
          logger.warn('No manifest found. Run `docpulse init` to initialize documentation.');
          return;
        }

        // Repository info
        logger.info('Repository:');
        logger.info(`  Package manager: ${manifest.repo.detected.packageManager}`);
        logger.info(`  Workspace: ${manifest.repo.detected.workspace}`);
        logger.info(`  Languages: ${manifest.repo.detected.languages.join(', ')}\n`);

        // Git status
        const gitState = await getGitState(cwd);
        logger.info('Git:');
        logger.info(`  Branch: ${gitState.currentBranch}`);
        logger.info(`  Commit: ${gitState.currentCommit.substring(0, 7)}`);
        logger.info(`  Clean: ${gitState.isClean ? 'yes' : 'no (uncommitted changes)'}\n`);

        // Last run info
        const lastRun = await getLastSuccessfulRun(cwd, config.docs.root);
        if (lastRun) {
          const timestamp = new Date(lastRun.timestamp);
          const commitMsg = await getCommitMessage(cwd, lastRun.gitCommit);

          logger.info('Last Successful Run:');
          logger.info(`  Date: ${timestamp.toLocaleString()}`);
          logger.info(`  Commit: ${lastRun.gitCommit.substring(0, 7)}`);
          if (commitMsg) {
            const firstLine = commitMsg.split('\n')[0];
            logger.info(`  Message: ${firstLine}`);
          }
          if (lastRun.notes) {
            logger.info(`  Notes: ${lastRun.notes}`);
          }
          logger.info('');
        } else {
          logger.info('Last Run: None\n');
        }

        // Documentation coverage
        logger.info('Documentation:');
        logger.info(`  Root: ${config.docs.root}`);
        logger.info(`  Units: ${manifest.units.length}`);
        logger.info(`  Coverage entries: ${manifest.coverageMap.length}`);
        logger.info(`  Run history: ${manifest.runs.history.length} entries\n`);

        // Show units
        if (manifest.units.length > 0 && manifest.units.length <= 10) {
          logger.info('Units:');
          for (const unit of manifest.units) {
            logger.info(`  - ${unit.id} (${unit.kind}) → ${unit.doc}`);
          }
        }
      } catch (error) {
        logger.error('Failed to show status:', error);
        process.exit(1);
      }
    });
}
