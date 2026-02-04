import { BASE_SYSTEM_PROMPT } from './system.js';
import type { LLMClient } from '../client.js';
import type { ProjectAnalysis } from '../../scan/analyze.js';
import type { DocCategory } from './structure.js';

/**
 * System prompt for category content generation
 */
export const CATEGORY_CONTENT_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Task: Generate an index.md file for a specific documentation category.

Structure:
- Brief intro paragraph (1-2 sentences explaining what this category covers)
- Section headings for each topic
- TODO markers with context for what needs to be documented
- Links to relevant code files where applicable

Guidelines:
- Keep it concise - this is a starting point, not exhaustive documentation
- Use ## for main topics, ### for subtopics
- Write TODO comments like: "TODO: Document [specific thing] (see src/path/to/file.ts)"
- Include code file references where relevant
- Don't invent details - if uncertain, use TODO markers

Output format: Pure Markdown (no code blocks wrapping the content)`;

/**
 * Create prompt for generating category content
 */
export function createCategoryContentPrompt(
  category: DocCategory,
  analysis: ProjectAnalysis
): string {
  let prompt = `Generate the index.md file for the "${category.name}" documentation category.

## Category Details
- **Name**: ${category.name}
- **Reason**: ${category.reason}
- **Topics to Cover**: ${category.topics.join(', ')}

## Project Context

`;

  // Add relevant project context
  prompt += `**Repository Type**: ${analysis.repoInfo.workspaceType}\n`;
  prompt += `**Package Manager**: ${analysis.repoInfo.packageManager}\n`;
  prompt += `**Languages**: ${analysis.repoInfo.languages.join(', ')}\n\n`;

  // Add folder structure
  if (analysis.topLevelStructure.folders.length > 0) {
    prompt += `**Top-Level Folders**: ${analysis.topLevelStructure.folders.slice(0, 10).join(', ')}\n\n`;
  }

  // Add package.json context
  if (analysis.packageJson.name) {
    prompt += `**Package**: ${analysis.packageJson.name}\n`;
  }
  if (analysis.packageJson.description) {
    prompt += `**Description**: ${analysis.packageJson.description}\n`;
  }
  if (analysis.packageJson.scripts && typeof analysis.packageJson.scripts === 'object') {
    const scripts = analysis.packageJson.scripts as Record<string, string>;
    const scriptNames = Object.keys(scripts).slice(0, 8);
    prompt += `**Available Scripts**: ${scriptNames.join(', ')}\n`;
  }
  prompt += '\n';

  // Add category-specific context
  prompt += getCategorySpecificContext(category.name, analysis);

  prompt += `\n---

Generate the index.md content for this category. Include:
1. A brief introduction (what this category covers)
2. Sections for each topic with TODO markers
3. References to relevant code files

Output the Markdown content directly (no wrapper code blocks):`;

  return prompt;
}

/**
 * Get category-specific context
 */
function getCategorySpecificContext(categoryName: string, analysis: ProjectAnalysis): string {
  let context = '';

  switch (categoryName) {
    case 'architecture':
      context += '**Architectural Context**:\n';
      if (analysis.unitsSummary.count > 1) {
        context += `- Multiple units (${analysis.unitsSummary.count}): ${analysis.unitsSummary.names.slice(0, 5).join(', ')}\n`;
      }
      if (analysis.topLevelStructure.folders.length > 0) {
        context += `- Main modules: ${analysis.topLevelStructure.folders.filter(f => f === 'src' || f === 'lib' || f === 'packages').join(', ')}\n`;
      }
      break;

    case 'how-to':
      context += '**How-To Context**:\n';
      if (analysis.hasTests) {
        context += '- Project has tests configured\n';
      }
      if (analysis.packageJson.scripts) {
        context += '- Available commands to document\n';
      }
      break;

    case 'api':
      context += '**API Context**:\n';
      if (analysis.packageJson.main || analysis.packageJson.exports) {
        context += `- Entry point: ${analysis.packageJson.main || 'via exports field'}\n`;
      }
      break;

    case 'release':
      context += '**Release Context**:\n';
      if (analysis.hasPublishConfig) {
        context += '- Package is configured for publishing\n';
      }
      if (analysis.hasCI) {
        context += '- CI/CD is configured\n';
      }
      break;

    case 'testing':
      context += '**Testing Context**:\n';
      if (analysis.hasTests) {
        context += '- Test framework detected\n';
      }
      if (analysis.packageJson.scripts) {
        const scripts = analysis.packageJson.scripts as Record<string, string>;
        if (scripts.test) {
          context += `- Test command: ${scripts.test}\n`;
        }
      }
      break;

    case 'contributing':
      context += '**Contributing Context**:\n';
      if (analysis.markdownFiles.some(f => f.path === 'CONTRIBUTING.md')) {
        context += '- CONTRIBUTING.md file exists\n';
      }
      if (analysis.hasCI) {
        context += '- CI/CD workflow is set up\n';
      }
      break;
  }

  return context;
}

/**
 * Generate category content using LLM
 */
export async function generateCategoryContent(
  llmClient: LLMClient,
  category: DocCategory,
  analysis: ProjectAnalysis
): Promise<string> {
  const prompt = createCategoryContentPrompt(category, analysis);

  const content = await llmClient.complete(
    [
      { role: 'system', content: CATEGORY_CONTENT_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.7 }
  );

  // Clean up the response (remove code block wrappers if present)
  let cleaned = content.trim();
  
  // Remove markdown code block wrappers
  const codeBlockMatch = cleaned.match(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  return cleaned;
}

/**
 * Create fallback category content (when LLM is not available)
 */
export function createFallbackCategoryContent(category: DocCategory): string {
  let content = `# ${capitalizeFirst(category.name)}\n\n`;

  // Add description
  content += getCategoryDescription(category.name) + '\n\n';

  // Add topics as sections with TODOs
  if (category.topics.length > 0) {
    content += '## Topics\n\n';
    for (const topic of category.topics) {
      content += `### ${topic}\n\n`;
      content += `TODO: Document ${topic.toLowerCase()}\n\n`;
    }
  } else {
    content += '## Overview\n\n';
    content += `TODO: Add ${category.name} documentation\n\n`;
  }

  return content;
}

/**
 * Get category description
 */
function getCategoryDescription(categoryName: string): string {
  const descriptions: Record<string, string> = {
    architecture: 'Cross-cutting architectural documentation covering the overall structure, design patterns, and key technical decisions in this project.',
    'how-to': 'Step-by-step guides for common tasks and workflows that developers need to perform.',
    api: 'Public API documentation including interfaces, classes, methods, and usage examples.',
    release: 'Documentation for the release process, including versioning, publishing, and deployment procedures.',
    contributing: 'Guidelines for contributing to this project, including setup instructions, coding standards, and the PR process.',
    deployment: 'Documentation for deploying and operating this project in different environments.',
    testing: 'Testing strategy, how to run tests, and guidelines for writing new tests.',
    troubleshooting: 'Common issues, debugging tips, and frequently asked questions.',
  };

  return descriptions[categoryName] || `Documentation for ${categoryName}.`;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
