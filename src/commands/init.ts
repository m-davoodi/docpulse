import { Command } from 'commander';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';
import { discoverRepository } from '../scan/discovery.js';
import { loadIgnoreRules } from '../scan/ignore.js';
import { partitionIntoUnits } from '../scan/units.js';
import { validateGitRepository, getCurrentCommit } from '../git/index.js';
import { createManifest, initializeCoverageMap } from '../manifest/index.js';
import { createLLMClient, generateLeafPrompt, LEAF_ANALYSIS_SYSTEM_PROMPT, CONVENTIONS_SYSTEM_PROMPT } from '../llm/index.js';

export function createInitCommand() {
  return new Command('init')
    .description('Bootstrap documentation folder for the repository')
    .option('--interactive', 'Run in interactive mode')
    .option('--dry-run', 'Show what would be created without writing files')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const config = await loadConfig(cwd);

        logger.info('Initializing DocPulse documentation...');
        logger.debug(`Working directory: ${cwd}`);

        // Validate git repository
        const gitValidation = await validateGitRepository(cwd);
        if (!gitValidation.isValid) {
          logger.error('Git validation failed:');
          gitValidation.errors.forEach((err) => logger.error(`  - ${err}`));
          process.exit(1);
        }

        if (gitValidation.warnings.length > 0) {
          gitValidation.warnings.forEach((warn) => logger.warn(`  ${warn}`));
        }

        // Discover repository
        logger.info('Discovering repository structure...');
        const repoInfo = await discoverRepository(cwd);
        logger.success(`Detected ${repoInfo.workspaceType} repository with ${repoInfo.packageManager}`);

        // Load ignore rules
        const ignoreRules = await loadIgnoreRules(cwd, config.ignore);

        // Partition into units
        logger.info('Analyzing repository structure...');
        const units = await partitionIntoUnits(repoInfo);
        logger.success(`Found ${units.length} documentation units`);

        if (options.dryRun) {
          logger.info('\n[DRY RUN] Would create:');
          logger.info(`  - docs/index.md (conventions)`);
          logger.info(`  - docs/architecture/ (cross-cutting docs)`);
          logger.info(`  - docs/how-to/ (guides)`);
          units.forEach((unit) => {
            if (unit.kind !== 'repo') {
              logger.info(`  - ${unit.doc}`);
            }
          });
          logger.info(`  - docs/.manifest.json`);
          return;
        }

        // Create docs directory structure
        const docsRoot = resolve(cwd, config.docs.root);
        await mkdir(docsRoot, { recursive: true });
        await mkdir(join(docsRoot, 'architecture'), { recursive: true });
        await mkdir(join(docsRoot, 'how-to'), { recursive: true });

        // Create manifest
        logger.info('Creating manifest...');
        const currentCommit = await getCurrentCommit(cwd);
        const manifest = await createManifest(
          cwd,
          {
            packageManager: repoInfo.packageManager,
            workspace: repoInfo.workspaceType,
            languages: repoInfo.languages,
          },
          units.map((u) => ({
            id: u.id,
            kind: u.kind,
            path: u.relativePath,
            doc: u.doc,
            entrypoints: u.entrypoints,
          })),
          ignoreRules.patterns,
          config.docs.root
        );

        // Initialize coverage map
        manifest.coverageMap = initializeCoverageMap(manifest.units);

        // Create LLM client if API key available
        let llmClient = null;
        if (config.llm.apiKey) {
          logger.info(`Using LLM: ${config.llm.model}`);
          llmClient = createLLMClient({
            baseUrl: config.llm.baseUrl,
            apiKey: config.llm.apiKey,
            model: config.llm.model,
          });
        } else {
          logger.warn('No LLM API key configured - will create stub documentation');
        }

        // Generate documentation
        logger.info('Generating documentation...');

        // Create stub architecture docs
        await writeFile(
          join(docsRoot, 'architecture/index.md'),
          `# Architecture\n\nCross-cutting architectural documentation will be added here.\n\n## Topics\n\n- Build system\n- Testing strategy\n- Deployment\n- Configuration\n`
        );

        // Create stub how-to docs
        await writeFile(
          join(docsRoot, 'how-to/index.md'),
          `# How-To Guides\n\nStep-by-step guides for common tasks.\n\n## Guides\n\n- Getting started\n- Running tests\n- Debugging\n- Contributing\n`
        );

        // Generate docs/index.md (conventions)
        const conventionsDoc = await generateConventionsDoc(llmClient, repoInfo, units);
        await writeFile(join(docsRoot, 'index.md'), conventionsDoc);

        logger.success(`Documentation initialized in ${config.docs.root}/`);
        logger.info('\nNext steps:');
        logger.info('  1. Review the generated documentation');
        logger.info('  2. Run `docpulse update` to update docs when code changes');
        logger.info('  3. Commit the docs/ folder to your repository');
      } catch (error) {
        logger.error('Failed to initialize:', error);
        process.exit(1);
      }
    });
}

async function generateConventionsDoc(
  llmClient: any,
  repoInfo: any,
  units: any[]
): Promise<string> {
  if (!llmClient) {
    // Create basic conventions without LLM
    return `# Documentation

This repository uses DocPulse for maintaining up-to-date documentation.

## Structure

- \`docs/index.md\` (this file): Documentation conventions and organization
- \`docs/architecture/\`: Cross-cutting architectural documentation
- \`docs/how-to/\`: Step-by-step guides for common tasks
${units.length > 1 ? `- \`docs/packages/\`: Per-package documentation\n` : ''}

## Conventions

- Write clear, concise documentation for developers
- Focus on "why" rather than "what" (code shows what)
- Include code examples where helpful
- Keep documentation close to the code it describes
- Update docs when making code changes

## Detected Structure

- Package manager: ${repoInfo.packageManager}
- Workspace type: ${repoInfo.workspaceType}
- Languages: ${repoInfo.languages.join(', ')}
- Units: ${units.length}
`;
  }

  // Generate with LLM
  try {
    const prompt = `Create a conventions document (docs/index.md) for this repository:

**Repository Info:**
- Package manager: ${repoInfo.packageManager}
- Workspace type: ${repoInfo.workspaceType}
- Languages: ${repoInfo.languages.join(', ')}
- Documentation units: ${units.length}

Include:
1. Purpose of documentation in this repo
2. How docs/ folder is organized
3. Writing conventions (tone, style, what to include/exclude)
4. How DocPulse should behave on updates

Write in Markdown format.`;

    const content = await llmClient.complete([
      { role: 'system', content: CONVENTIONS_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ]);

    return content;
  } catch (error) {
    logger.warn('Failed to generate conventions with LLM, using fallback');
    return generateConventionsDoc(null, repoInfo, units);
  }
}
