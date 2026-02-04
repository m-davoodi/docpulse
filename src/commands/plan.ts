import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';
import { readManifest, getLastSuccessfulRun } from '../manifest/index.js';
import { getChangedFiles, getDiffStats } from '../git/index.js';
import { mapFilesToDocs } from '../manifest/coverage.js';

export function createPlanCommand() {
  return new Command('plan')
    .description('Show which documents would be updated (no writes)')
    .option('--since <commit>', 'Compare against specific commit')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const config = await loadConfig(cwd);

        logger.info('Documentation Update Plan');
        logger.info('========================\n');

        // Load manifest
        const manifest = await readManifest(cwd, config.docs.root);
        if (!manifest) {
          logger.error('No manifest found. Run `docpulse init` first.');
          process.exit(1);
        }

        // Determine baseline commit
        const lastRun = await getLastSuccessfulRun(cwd, config.docs.root);
        const baseCommit = options.since || lastRun?.gitCommit;

        if (!baseCommit) {
          logger.error('No previous run found and no --since commit specified');
          logger.info('Tip: Use --since <commit> to specify the baseline commit');
          process.exit(1);
        }

        logger.info(`Baseline: ${baseCommit.substring(0, 7)}`);
        logger.info(`Target: HEAD\n`);

        // Get changed files and stats
        const changedFiles = await getChangedFiles(cwd, baseCommit);
        const stats = await getDiffStats(cwd, baseCommit);

        logger.info('Changes:');
        logger.info(`  Files changed: ${changedFiles.length}`);
        logger.info(`  Additions: +${stats.additions}`);
        logger.info(`  Deletions: -${stats.deletions}\n`);

        if (changedFiles.length === 0) {
          logger.success('No changes detected - no documentation updates needed');
          return;
        }

        // Show changed files
        if (changedFiles.length <= 20) {
          logger.info('Changed files:');
          for (const file of changedFiles) {
            logger.info(`  - ${file}`);
          }
          logger.info('');
        } else {
          logger.info(`Changed files: ${changedFiles.length} (too many to list)\n`);
        }

        // Map to affected docs
        const affectedDocs = mapFilesToDocs(changedFiles, manifest.coverageMap);

        if (affectedDocs.size === 0) {
          logger.success('No documentation files would be affected');
          return;
        }

        logger.info(`Documentation to update: ${affectedDocs.size} files\n`);

        logger.info('Affected documentation:');
        for (const [doc, files] of affectedDocs) {
          logger.info(`\n  ${doc}`);
          logger.info(`  └─ ${files.length} changed ${files.length === 1 ? 'file' : 'files'}`);
          if (files.length <= 5) {
            for (const file of files) {
              logger.info(`     - ${file}`);
            }
          } else {
            for (const file of files.slice(0, 3)) {
              logger.info(`     - ${file}`);
            }
            logger.info(`     ... and ${files.length - 3} more`);
          }
        }

        logger.info('\nTo apply these updates, run: docpulse update');
      } catch (error) {
        logger.error('Failed to generate plan:', error);
        process.exit(1);
      }
    });
}
