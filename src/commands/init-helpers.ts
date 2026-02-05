import type { LLMClient } from '../llm/client.js';
import type { ProjectAnalysis } from '../scan/analyze.js';
import type { RepoInfo } from '../scan/discovery.js';
import type { Unit } from '../scan/units.js';
import { logger } from '../utils/logger.js';
import {
  createStructurePlanningSystemPrompt,
  createStructurePlanningPrompt,
  parseStructurePlanningResponse,
  type DocCategory,
} from '../llm/prompts/structure.js';
import { CONVENTIONS_SYSTEM_PROMPT } from '../llm/prompts/system.js';

export interface DocStructure {
  categories: DocCategory[];
}

/**
 * Plan documentation structure using LLM
 */
export async function planDocStructure(
  llmClient: LLMClient,
  analysis: ProjectAnalysis,
  fullContext: string,
  requestedFiles: string[],
  requiredCategories: string[]
): Promise<DocStructure> {
  logger.debug('Planning documentation structure with LLM...');

  const systemPrompt = createStructurePlanningSystemPrompt(requiredCategories);
  const prompt = createStructurePlanningPrompt(fullContext, requestedFiles, requiredCategories);

  try {
    const response = await llmClient.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.5 }
    );

    const result = parseStructurePlanningResponse(response, requiredCategories);
    
    logger.debug(`LLM planned ${result.categories.length} categories`);
    
    return result;
  } catch (error) {
    logger.error('Failed to plan structure with LLM:', error);
    logger.warn('Falling back to default structure');
    return createDefaultStructure(requiredCategories);
  }
}

/**
 * Create default documentation structure (fallback)
 */
export function createDefaultStructure(requiredCategories: string[]): DocStructure {
  const categoryDefaults: Record<string, { reason: string; topics: string[] }> = {
    architecture: {
      reason: 'Default: Cross-cutting architectural documentation',
      topics: [
        'Project structure',
        'Key modules and components',
        'Design patterns',
        'Technology stack',
      ],
    },
    'how-to': {
      reason: 'Default: Practical guides for common tasks',
      topics: [
        'Getting started',
        'Development workflow',
        'Running tests',
        'Debugging',
        'Contributing',
      ],
    },
    onboarding: {
      reason: 'Default: Getting started guides for new developers',
      topics: [
        'Prerequisites',
        'Installation',
        'First steps',
        'Project overview',
      ],
    },
  };

  return {
    categories: requiredCategories.map((name) => ({
      name,
      reason: categoryDefaults[name]?.reason || `Default: ${name} documentation`,
      topics: categoryDefaults[name]?.topics || [],
    })),
  };
}

/**
 * Generate conventions document (enhanced version)
 */
export async function generateEnhancedConventionsDoc(
  llmClient: LLMClient | null,
  repoInfo: RepoInfo,
  units: Unit[],
  docStructure: DocStructure
): Promise<string> {
  if (!llmClient) {
    return createFallbackConventionsDoc(repoInfo, units, docStructure);
  }

  try {
    const prompt = createConventionsPrompt(repoInfo, units, docStructure);

    const content = await llmClient.complete(
      [
        { role: 'system', content: CONVENTIONS_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.7 }
    );

    return content.trim();
  } catch (error) {
    logger.warn('Failed to generate conventions with LLM, using fallback');
    return createFallbackConventionsDoc(repoInfo, units, docStructure);
  }
}

/**
 * Create conventions prompt
 */
function createConventionsPrompt(
  repoInfo: RepoInfo,
  units: Unit[],
  docStructure: DocStructure
): string {
  let prompt = `Create a conventions document (docs/index.md) for this repository.

## Repository Information
- Package manager: ${repoInfo.packageManager}
- Workspace type: ${repoInfo.workspaceType}
- Languages: ${repoInfo.languages.join(', ')}
- Documentation units: ${units.length}

## Documentation Structure
DocPulse has analyzed this project and created the following documentation categories:

`;

  for (const category of docStructure.categories) {
    prompt += `### ${category.name}\n`;
    prompt += `**Why**: ${category.reason}\n`;
    if (category.topics.length > 0) {
      prompt += `**Topics**: ${category.topics.join(', ')}\n`;
    }
    prompt += '\n';
  }

  prompt += `\n---

The conventions document should include:
1. **Purpose**: Why documentation exists in this repository
2. **Organization**: How the docs/ folder is structured (explain each category)
3. **Writing conventions**: Tone, style, what to include/exclude
4. **Update rules**: How DocPulse should behave on updates
5. **Evidence-based principle**: Only document what can be verified

Write in Markdown format.`;

  return prompt;
}

/**
 * Create fallback conventions document
 */
function createFallbackConventionsDoc(
  repoInfo: RepoInfo,
  units: Unit[],
  docStructure: DocStructure
): string {
  let content = '# Documentation Conventions\n\n';

  // Purpose
  content += '## Purpose\n\n';
  content += 'This repository uses DocPulse for maintaining up-to-date documentation. ';
  content += 'Documentation is automatically generated and updated based on code changes, ';
  content += 'ensuring it stays synchronized with the codebase.\n\n';

  // Organization
  content += '## Organization\n\n';
  content += 'The `docs/` directory is structured as follows:\n\n';
  content += '- `index.md` (this file): Documentation conventions and organization\n';

  for (const category of docStructure.categories) {
    content += `- \`${category.name}/\`: ${category.reason}\n`;
  }

  if (units.length > 1) {
    content += '\nFor monorepo/multi-package projects:\n';
    content += '- Per-package documentation may be generated in subdirectories\n';
  }

  content += '\n';

  // Categories details
  content += '## Documentation Categories\n\n';
  
  for (const category of docStructure.categories) {
    content += `### ${capitalizeFirst(category.name)}\n\n`;
    content += `${category.reason}\n\n`;
    
    if (category.topics.length > 0) {
      content += 'Topics covered:\n';
      for (const topic of category.topics) {
        content += `- ${topic}\n`;
      }
      content += '\n';
    }
  }

  // Writing Conventions
  content += '## Writing Conventions\n\n';
  content += '### Tone and Style\n\n';
  content += '- Write clear, concise documentation for developers\n';
  content += '- Use a professional but approachable tone\n';
  content += '- Focus on "why" rather than "what" (code shows what)\n';
  content += '- Include practical examples where helpful\n\n';

  content += '### Content Guidelines\n\n';
  content += '- **Evidence-based**: Only document what can be verified from the code\n';
  content += '- **TODO markers**: Flag uncertainties with "TODO: verify [detail]"\n';
  content += '- **Code references**: Link to relevant source files\n';
  content += '- **Keep it updated**: Documentation should reflect current state of code\n\n';

  // Update behavior
  content += '## DocPulse Update Behavior\n\n';
  content += 'When DocPulse updates documentation:\n\n';
  content += '1. It analyzes git changes since the last run\n';
  content += '2. It computes the dependency graph to find impacted files\n';
  content += '3. It updates only affected documentation sections\n';
  content += '4. It maintains consistency with these conventions\n';
  content += '5. It uses TODO markers when certainty is low\n\n';

  // Repository context
  content += '## Repository Context\n\n';
  content += `- Package manager: ${repoInfo.packageManager}\n`;
  content += `- Workspace type: ${repoInfo.workspaceType}\n`;
  content += `- Languages: ${repoInfo.languages.join(', ')}\n`;
  content += `- Documentation units: ${units.length}\n`;

  return content;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
