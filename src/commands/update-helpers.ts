import { relative } from 'path';
import type { Manifest } from '../manifest/schema.js';
import type { DocCategory } from '../llm/prompts/structure.js';
import { logger } from '../utils/logger.js';

export interface CategoryUpdatePlan {
  category: string;
  docPath: string;
  reason: string;
  impactedFiles: string[];
  topics: string[];
}

/**
 * Plan category updates based on impacted files and manifest structure
 */
export async function planCategoryUpdates(
  impactedFiles: string[],
  manifest: Manifest,
  cwd: string
): Promise<CategoryUpdatePlan[]> {
  logger.debug('Planning category updates...');

  const plans: CategoryUpdatePlan[] = [];

  // Get categories from manifest's docStructure (enhanced init format)
  const categories = manifest.docLayout.docStructure?.categories || [];

  if (categories.length === 0) {
    logger.warn('No docStructure found in manifest, using fallback');
    return createFallbackPlans(impactedFiles, manifest, cwd);
  }

  // Categorize impacted files by which category they belong to
  const categoryToFiles = categorizeImpactedFiles(impactedFiles, categories, cwd);

  // Create update plan for each affected category
  for (const [categoryName, files] of categoryToFiles) {
    const category = categories.find(c => c.name === categoryName);
    if (!category) continue;

    const docPath = `${manifest.docLayout.root}/${categoryName}/index.md`;
    const reason = inferUpdateReason(files, categoryName, cwd);

    plans.push({
      category: categoryName,
      docPath,
      reason,
      impactedFiles: files,
      topics: category.topics || [],
    });
  }

  logger.debug(`Created ${plans.length} category update plans`);
  return plans;
}

/**
 * Categorize impacted files by documentation category
 */
export function categorizeImpactedFiles(
  files: string[],
  categories: DocCategory[],
  cwd: string
): Map<string, string[]> {
  const categoryToFiles = new Map<string, string[]>();

  for (const file of files) {
    const relPath = file.startsWith(cwd) ? relative(cwd, file) : file;
    const category = determineCategory(relPath, categories);

    if (category) {
      if (!categoryToFiles.has(category)) {
        categoryToFiles.set(category, []);
      }
      categoryToFiles.get(category)!.push(relPath);
    }
  }

  return categoryToFiles;
}

/**
 * Determine which category a file belongs to based on heuristics
 */
function determineCategory(filePath: string, categories: DocCategory[]): string | null {
  const normalizedPath = filePath.toLowerCase();

  // Check if we have testing category and file is a test
  if (categories.some(c => c.name === 'testing')) {
    if (
      normalizedPath.includes('__tests__') ||
      normalizedPath.includes('.test.') ||
      normalizedPath.includes('.spec.') ||
      normalizedPath.includes('vitest.config') ||
      normalizedPath.includes('jest.config')
    ) {
      return 'testing';
    }
  }

  // Check if we have contributing category and file is related
  if (categories.some(c => c.name === 'contributing')) {
    if (
      normalizedPath.includes('contributing') ||
      normalizedPath === '.github/contributing.md' ||
      normalizedPath.includes('.github/workflows')
    ) {
      return 'contributing';
    }
  }

  // Check if we have release category and file is related
  if (categories.some(c => c.name === 'release')) {
    if (
      normalizedPath.includes('package.json') ||
      normalizedPath.includes('tsup.config') ||
      normalizedPath.includes('build') ||
      normalizedPath.includes('.github/workflows') && normalizedPath.includes('release')
    ) {
      return 'release';
    }
  }

  // Check if we have API category and file exports public API
  if (categories.some(c => c.name === 'api')) {
    if (
      normalizedPath.includes('src/index.') ||
      normalizedPath.includes('/api/') ||
      normalizedPath.includes('types.ts')
    ) {
      return 'api';
    }
  }

  // Check if we have how-to category and file is a command
  if (categories.some(c => c.name === 'how-to')) {
    if (
      normalizedPath.includes('src/commands/') ||
      normalizedPath.includes('cli')
    ) {
      return 'how-to';
    }
  }

  // Default to architecture for source code files
  if (categories.some(c => c.name === 'architecture')) {
    if (
      normalizedPath.startsWith('src/') ||
      normalizedPath.includes('.ts') ||
      normalizedPath.includes('.js')
    ) {
      return 'architecture';
    }
  }

  // If no match and we have architecture, default to that
  if (categories.some(c => c.name === 'architecture')) {
    return 'architecture';
  }

  return null;
}

/**
 * Infer a human-readable reason for why this category needs updating
 */
function inferUpdateReason(files: string[], categoryName: string, cwd: string): string {
  const relFiles = files.map(f => f.startsWith(cwd) ? relative(cwd, f) : f);
  const fileCount = files.length;

  // Get file type breakdown
  const byType = {
    commands: relFiles.filter(f => f.includes('commands/')).length,
    tests: relFiles.filter(f => f.includes('test') || f.includes('spec')).length,
    config: relFiles.filter(f => f.includes('config') || f.includes('package.json')).length,
    source: relFiles.filter(f => f.startsWith('src/')).length,
  };

  // Generate context-aware reason
  if (categoryName === 'testing' && byType.tests > 0) {
    return `${byType.tests} test file${byType.tests > 1 ? 's' : ''} changed`;
  }

  if (categoryName === 'how-to' && byType.commands > 0) {
    return `${byType.commands} command file${byType.commands > 1 ? 's' : ''} modified`;
  }

  if (categoryName === 'release' && byType.config > 0) {
    return `Build or package configuration changed`;
  }

  if (categoryName === 'architecture' && byType.source > 0) {
    return `${byType.source} source file${byType.source > 1 ? 's' : ''} modified in core modules`;
  }

  // Generic reason
  return `${fileCount} file${fileCount > 1 ? 's' : ''} changed affecting this category`;
}

/**
 * Create fallback plans when manifest has no docStructure
 */
function createFallbackPlans(
  impactedFiles: string[],
  manifest: Manifest,
  cwd: string
): CategoryUpdatePlan[] {
  logger.debug('Using fallback category planning');

  // Use coverage map to determine affected docs
  const plans: CategoryUpdatePlan[] = [];

  for (const entry of manifest.coverageMap) {
    const affectedFiles = impactedFiles.filter(file => {
      const relPath = file.startsWith(cwd) ? relative(cwd, file) : file;
      // Simple pattern matching
      return entry.covers.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
        return regex.test(relPath);
      });
    });

    if (affectedFiles.length > 0) {
      // Extract category name from doc path
      const pathParts = entry.doc.split('/');
      const category = pathParts[pathParts.length - 2] || 'docs';

      plans.push({
        category,
        docPath: entry.doc,
        reason: `${affectedFiles.length} file${affectedFiles.length > 1 ? 's' : ''} changed`,
        impactedFiles: affectedFiles.map(f => 
          f.startsWith(cwd) ? relative(cwd, f) : f
        ),
        topics: [],
      });
    }
  }

  return plans;
}
