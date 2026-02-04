import { Command } from 'commander';
import { mkdir, writeFile, access } from 'fs/promises';
import { resolve, join } from 'path';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';
import { discoverRepository } from '../scan/discovery.js';
import { loadIgnoreRules } from '../scan/ignore.js';
import { partitionIntoUnits } from '../scan/units.js';
import { analyzeProject } from '../scan/analyze.js';
import { validateGitRepository } from '../git/index.js';
import { createManifest, initializeCoverageMap } from '../manifest/index.js';
import { createLLMClient } from '../llm/index.js';
import { InteractiveContextProvider } from '../llm/context-provider.js';
import { generateCategoryContent, createFallbackCategoryContent } from '../llm/prompts/category.js';
import {
  planDocStructure,
  createDefaultStructure,
  generateEnhancedConventionsDoc,
  type DocStructure,
} from './init-helpers.js';

export function createInitCommand() {
  return new Command('init')
    .description('Bootstrap documentation folder for the repository')
    .option('--interactive', 'Run in interactive mode')
    .option('--dry-run', 'Show what would be created without writing files')
    .option('--force', 'Regenerate documentation even if it already exists')
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

        // Check if docs already exist
        const docsRoot = resolve(cwd, config.docs.root);
        const manifestPath = join(docsRoot, '.manifest.json');
        try {
          await access(manifestPath);
          if (!options.force) {
            logger.warn('Documentation already initialized. Use --force to regenerate.');
            logger.info('Run `docpulse update` to update existing docs.');
            process.exit(0);
          }
          logger.info('Forcing reinitialization...');
        } catch {
          // Manifest doesn't exist, proceed
        }

        // Step 1: Analyze project
        logger.info('Analyzing project structure...');
        const analysis = await analyzeProject(cwd, repoInfo, units);

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
          logger.warn('No LLM API key configured - will create default structure');
        }

        // Step 2: Interactive structure planning with LLM
        let docStructure: DocStructure;
        let requestedFiles: string[] = [];

        if (llmClient) {
          logger.info('Planning documentation structure with LLM...');
          const contextProvider = new InteractiveContextProvider();
          const { fullContext, requestedFiles: files } = await contextProvider.gatherContext(
            llmClient,
            analysis,
            cwd
          );
          requestedFiles = files;

          docStructure = await planDocStructure(llmClient, analysis, fullContext, requestedFiles);
          logger.success(`Planned ${docStructure.categories.length} documentation categories`);

          docStructure.categories.forEach((cat) => {
            logger.info(`  - ${cat.name}: ${cat.reason}`);
          });
        } else {
          // Fallback: Use minimum categories
          logger.warn('Using default structure (architecture, how-to)');
          docStructure = createDefaultStructure();
        }

        // Dry run preview
        if (options.dryRun) {
          logger.info('\n[DRY RUN] Would create:');
          logger.info(`  - docs/index.md (conventions)`);
          docStructure.categories.forEach((cat) => {
            logger.info(`  - docs/${cat.name}/index.md`);
          });
          units.forEach((unit) => {
            if (unit.kind !== 'repo') {
              logger.info(`  - ${unit.doc}`);
            }
          });
          logger.info(`  - docs/.manifest.json`);
          return;
        }

        // Step 3: Create folder structure
        logger.info('Creating documentation folders...');
        await mkdir(docsRoot, { recursive: true });

        for (const category of docStructure.categories) {
          await mkdir(join(docsRoot, category.name), { recursive: true });
          logger.debug(`Created docs/${category.name}/`);
        }

        // Step 4: Generate category content
        logger.info('Generating documentation content...');
        for (const category of docStructure.categories) {
          const content = llmClient
            ? await generateCategoryContent(llmClient, category, analysis)
            : createFallbackCategoryContent(category);

          await writeFile(join(docsRoot, category.name, 'index.md'), content);
          logger.success(`Generated docs/${category.name}/index.md`);
        }

        // Step 5: Generate conventions
        logger.info('Creating documentation conventions...');
        const conventionsDoc = await generateEnhancedConventionsDoc(
          llmClient,
          repoInfo,
          units,
          docStructure
        );
        await writeFile(join(docsRoot, 'index.md'), conventionsDoc);
        logger.success('Generated docs/index.md');

        // Step 6: Create manifest with structure info
        logger.info('Creating manifest...');
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

        // Add structure info to manifest
        manifest.docLayout.docStructure = {
          categories: docStructure.categories.map((cat) => ({
            ...cat,
            createdAt: new Date().toISOString(),
          })),
          analysisVersion: '1',
        };

        // Write manifest
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        logger.success('Created docs/.manifest.json');

        logger.success(`\nDocumentation initialized in ${config.docs.root}/`);
        logger.info('\nGenerated categories:');
        docStructure.categories.forEach((cat) => {
          logger.info(`  - ${cat.name}: ${cat.reason}`);
        });

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
