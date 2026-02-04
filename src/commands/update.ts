import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';
import { readManifest, getLastSuccessfulRun, updateLastRun } from '../manifest/index.js';
import { getChangedFiles, getCurrentCommit } from '../git/index.js';
import { mapFilesToDocs } from '../manifest/coverage.js';
import { createLLMClient, generateUpdatePrompt, UPDATE_SYSTEM_PROMPT } from '../llm/index.js';

export function createUpdateCommand() {
  return new Command('update')
    .description('Update documentation based on code changes')
    .option('--since <commit>', 'Override last commit from manifest')
    .option('--dry-run', 'Show what would be updated without writing files')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const config = await loadConfig(cwd);

        logger.info('Updating documentation...');

        // Load manifest
        const manifest = await readManifest(cwd, config.docs.root);
        if (!manifest) {
          logger.error('No manifest found. Run `docpulse init` first.');
          process.exit(1);
        }

        // Determine last commit
        const lastRun = await getLastSuccessfulRun(cwd, config.docs.root);
        const lastCommit = options.since || lastRun?.gitCommit;

        if (!lastCommit) {
          logger.error('No previous run found and no --since commit specified');
          logger.info('Tip: Use --since <commit> to specify the baseline commit');
          process.exit(1);
        }

        logger.info(`Checking changes since ${lastCommit.substring(0, 7)}`);

        // Get changed files
        const changedFiles = await getChangedFiles(cwd, lastCommit);

        if (changedFiles.length === 0) {
          logger.success('No changes detected - documentation is up to date');
          return;
        }

        logger.info(`Found ${changedFiles.length} changed files`);

        // Map to affected docs
        const affectedDocs = mapFilesToDocs(changedFiles, manifest.coverageMap);

        if (affectedDocs.size === 0) {
          logger.success('No documentation files affected by changes');
          return;
        }

        logger.info(`${affectedDocs.size} documentation files need updating`);

        if (options.dryRun) {
          logger.info('\n[DRY RUN] Would update:');
          for (const [doc, files] of affectedDocs) {
            logger.info(`  - ${doc} (${files.length} changed files)`);
          }
          return;
        }

        // Create LLM client
        if (!config.llm.apiKey) {
          logger.error('No LLM API key configured. Set OPENAI_API_KEY or configure in docpulse.config.json');
          process.exit(1);
        }

        const llmClient = createLLMClient({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey,
          model: config.llm.model,
        });

        // Load conventions
        const conventionsPath = resolve(cwd, config.docs.root, 'index.md');
        let conventions = '';
        try {
          conventions = await readFile(conventionsPath, 'utf-8');
        } catch {
          logger.warn('Could not load conventions from docs/index.md');
        }

        // Update each affected doc
        for (const [docPath, files] of affectedDocs) {
          try {
            logger.info(`Updating ${docPath}...`);

            const fullDocPath = resolve(cwd, docPath);
            let existingContent = '';
            try {
              existingContent = await readFile(fullDocPath, 'utf-8');
            } catch {
              logger.warn(`  ${docPath} does not exist yet, will create new`);
              existingContent = `# ${docPath}\n\nDocumentation placeholder.\n`;
            }

            const prompt = generateUpdatePrompt({
              docPath,
              existingContent,
              changedFiles: files,
              conventions,
            });

            const updatedContent = await llmClient.complete([
              { role: 'system', content: UPDATE_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ]);

            await writeFile(fullDocPath, updatedContent, 'utf-8');
            logger.success(`  Updated ${docPath}`);
          } catch (error) {
            logger.error(`  Failed to update ${docPath}:`, error);
          }
        }

        // Update manifest
        const currentCommit = await getCurrentCommit(cwd);
        await updateLastRun(cwd, currentCommit, true, `Updated ${affectedDocs.size} docs`, config.docs.root);

        logger.success('\nDocumentation updated successfully');
        logger.info(`Updated ${affectedDocs.size} files`);
      } catch (error) {
        logger.error('Failed to update:', error);
        process.exit(1);
      }
    });
}
