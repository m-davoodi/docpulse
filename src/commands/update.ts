import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';
import { readManifest, getLastSuccessfulRun, updateLastRun } from '../manifest/index.js';
import { getChangedFiles, getCurrentCommit, getFileDiffs } from '../git/index.js';
import { loadIgnoreRules } from '../scan/ignore.js';
import { buildGraphForDirectory, computeImpactedClosure } from '../graph/index.js';
import { createLLMClient } from '../llm/index.js';
import { UpdateContextProvider } from '../llm/update-context-provider.js';
import { planCategoryUpdates } from './update-helpers.js';
import {
  ENHANCED_UPDATE_SYSTEM_PROMPT,
  createCategoryUpdatePrompt,
  summarizeChanges,
} from '../llm/prompts/update-enhanced.js';

/**
 * Capitalize first letter of a string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function createUpdateCommand() {
  return new Command('update')
    .description('Update documentation based on code changes')
    .option('--since <commit>', 'Override last commit from manifest')
    .option('--bootstrap', 'Fill in TODOs in newly initialized docs (processes all categories)')
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
        let lastCommit = options.since || lastRun?.gitCommit;

        // Bootstrap mode: process all docs without requiring changes
        if (options.bootstrap) {
          logger.info('Bootstrap mode: Processing all documentation categories');
          const currentCommit = await getCurrentCommit(cwd);
          lastCommit = currentCommit; // Use current commit as baseline
        } else {
          if (!lastCommit) {
            logger.error('No previous run found and no --since commit specified');
            logger.info('Tip: Use --since <commit> to specify the baseline commit');
            logger.info('Or use --bootstrap to fill in TODOs in newly initialized docs');
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
        }

        // Plan category updates
        let updatePlans;
        
        if (options.bootstrap) {
          // Bootstrap mode: Process all categories
          logger.info('Bootstrap mode: Processing all documentation categories');
          
          const categories = manifest.docLayout.docStructure?.categories || [];
          
          if (categories.length === 0) {
            logger.error('No docStructure found in manifest. Run `docpulse init` with the enhanced version first.');
            process.exit(1);
          }
          
          // Create update plans for all categories (no specific files filter)
          updatePlans = categories.map(category => ({
            category: category.name,
            docPath: `${manifest.docLayout.root}/${category.name}/index.md`,
            reason: 'Bootstrap: filling in TODOs and generating comprehensive documentation',
            impactedFiles: [], // Will be populated by context provider as needed
            topics: category.topics || [],
          }));
          
          logger.info(`Processing ${updatePlans.length} categories in bootstrap mode`);
        } else {
          // Normal mode: Only process changed files
          const changedFiles = await getChangedFiles(cwd, lastCommit!);
          
          // Load ignore rules for graph building
          const ignoreRules = await loadIgnoreRules(cwd, config.ignore);

          // Build dependency graph
          logger.info('Building dependency graph...');
          const graph = await buildGraphForDirectory(
            resolve(cwd, 'src'),
            ignoreRules.patterns,
            cwd
          );

          // Compute impacted closure (includes dependents)
          const impactedFiles = computeImpactedClosure(
            changedFiles.map(f => resolve(cwd, f)),
            graph,
            3 // maxDepth
          );

          logger.info(`${changedFiles.length} changed → ${impactedFiles.size} impacted (with dependents)`);

          // Plan category updates using manifest's docStructure
          updatePlans = await planCategoryUpdates(
            Array.from(impactedFiles),
            manifest,
            cwd
          );
        }

        if (updatePlans.length === 0) {
          logger.success('No documentation categories affected by changes');
          return;
        }

        logger.info(`${updatePlans.length} categories need updating`);
        updatePlans.forEach((plan) => {
          logger.info(`  - ${plan.category}: ${plan.impactedFiles.length} files`);
        });

        if (options.dryRun) {
          logger.info('\n[DRY RUN] Would update:');
          for (const plan of updatePlans) {
            logger.info(`  - ${plan.docPath}`);
            logger.info(`    Reason: ${plan.reason}`);
            const preview = plan.impactedFiles.slice(0, 3).join(', ');
            logger.info(`    Files: ${preview}${plan.impactedFiles.length > 3 ? '...' : ''}`);
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

        // Update each affected category
        for (const plan of updatePlans) {
          try {
            logger.info(`Updating ${plan.category}...`);

            // Load existing doc
            const fullDocPath = resolve(cwd, plan.docPath);
            let existingContent = '';
            try {
              existingContent = await readFile(fullDocPath, 'utf-8');
            } catch {
              logger.warn(`  ${plan.docPath} does not exist, creating new`);
              existingContent = `# ${capitalizeFirst(plan.category)}\n\nDocumentation placeholder.\n`;
            }

            // Get detailed diffs for impacted files
            const diffs = await getFileDiffs(cwd, lastCommit, plan.impactedFiles);
            logger.debug(`  Retrieved ${diffs.length} diffs: ${summarizeChanges(diffs)}`);

            // Interactive context gathering
            const contextProvider = new UpdateContextProvider();
            const context = await contextProvider.gatherUpdateContext(
              llmClient,
              plan,
              existingContent,
              diffs,
              cwd
            );

            // Generate update prompt
            const prompt = createCategoryUpdatePrompt(
              plan,
              existingContent,
              context,
              conventions
            );

            // Call LLM
            const updatedContent = await llmClient.complete(
              [
                { role: 'system', content: ENHANCED_UPDATE_SYSTEM_PROMPT },
                { role: 'user', content: prompt },
              ],
              { temperature: 0.7 }
            );

            // Clean up response (remove code block wrappers if present)
            let cleaned = updatedContent.trim();
            const codeBlockMatch = cleaned.match(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/);
            if (codeBlockMatch) {
              cleaned = codeBlockMatch[1].trim();
            }

            await writeFile(fullDocPath, cleaned, 'utf-8');
            logger.success(`  Updated ${plan.category}`);
          } catch (error) {
            logger.error(`  Failed to update ${plan.category}:`, error);
          }
        }

        // Update manifest
        const currentCommit = await getCurrentCommit(cwd);
        await updateLastRun(
          cwd,
          currentCommit,
          true,
          `Updated ${updatePlans.length} categories`,
          config.docs.root
        );

        logger.success('\nDocumentation updated successfully');
        logger.info(`Updated ${updatePlans.length} categories`);
      } catch (error) {
        logger.error('Failed to update:', error);
        process.exit(1);
      }
    });
}
