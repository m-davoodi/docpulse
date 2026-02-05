import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';
import type { LLMClient } from './client.js';
import type { ProjectAnalysis } from '../scan/analyze.js';

export interface ContextRequest {
  needsMoreContext: boolean;
  requestFile: string | null;
  reason?: string;
}

export interface ContextGatheringResult {
  fullContext: string;
  requestedFiles: string[];
}

/**
 * Interactive context provider that allows LLM to request specific files
 */
export class InteractiveContextProvider {
  private providedFiles: Set<string> = new Set();
  private maxIterations = 5;
  private maxFileSize = 10000; // 10KB per file

  /**
   * Gather context interactively by allowing LLM to request files
   */
  async gatherContext(
    llmClient: LLMClient,
    initialContext: ProjectAnalysis,
    cwd: string
  ): Promise<ContextGatheringResult> {
    logger.debug('Starting interactive context gathering...');

    const requestedFiles: string[] = [];
    let additionalContext = '';
    let iteration = 0;

    // Format initial context
    const initialContextStr = this.formatContextForLLM(initialContext);

    while (iteration < this.maxIterations) {
      iteration++;
      logger.debug(`Context gathering iteration ${iteration}/${this.maxIterations}`);

      // Ask LLM if it needs more context
      const prompt = this.createContextRequestPrompt(
        initialContextStr,
        additionalContext,
        iteration
      );

      try {
        const response = await llmClient.complete(
          [
            {
              role: 'system',
              content: 'You are analyzing a codebase to plan documentation structure. You can request specific files to better understand the project.',
            },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.3 }
        );

        // Parse response
        const request = this.parseContextRequest(response);

        if (!request.needsMoreContext || !request.requestFile) {
          logger.debug('LLM has enough context, stopping iteration');
          break;
        }

        // Provide the requested file
        logger.info(`LLM requested: ${request.requestFile} (${request.reason || 'no reason given'})`);
        
        const fileContent = await this.provideFile(request.requestFile, cwd);
        
        if (fileContent) {
          requestedFiles.push(request.requestFile);
          this.providedFiles.add(request.requestFile);
          additionalContext += `\n\n--- File: ${request.requestFile} ---\n${fileContent}\n`;
          logger.debug(`Provided file: ${request.requestFile} (${fileContent.length} chars)`);
        } else {
          logger.warn(`Could not provide file: ${request.requestFile}`);
          // Add a note that the file wasn't available
          additionalContext += `\n\n--- File: ${request.requestFile} (NOT AVAILABLE) ---\n`;
        }
      } catch (error) {
        logger.warn('Failed to get context request from LLM:', error);
        break;
      }
    }

    if (iteration >= this.maxIterations) {
      logger.warn('Reached maximum context gathering iterations');
    }

    const fullContext = initialContextStr + additionalContext;
    logger.success(`Context gathering complete: ${requestedFiles.length} additional files`);

    return {
      fullContext,
      requestedFiles,
    };
  }

  /**
   * Provide a file to the LLM
   */
  private async provideFile(path: string, cwd: string): Promise<string | null> {
    // Check if already provided
    if (this.providedFiles.has(path)) {
      logger.debug(`File already provided: ${path}`);
      return null;
    }

    try {
      const fullPath = resolve(cwd, path);
      const stats = await stat(fullPath);

      // Check file size
      if (stats.size > this.maxFileSize) {
        logger.warn(`File too large (${stats.size} bytes), truncating: ${path}`);
        const content = await readFile(fullPath, 'utf-8');
        return content.slice(0, this.maxFileSize) + '\n\n... (truncated)';
      }

      const content = await readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      logger.debug(`Failed to read file ${path}:`, error);
      return null;
    }
  }

  /**
   * Format project analysis for LLM
   */
  private formatContextForLLM(analysis: ProjectAnalysis): string {
    let context = '# Project Analysis\n\n';

    // Repository info
    context += '## Repository Information\n';
    context += `- Package Manager: ${analysis.repoInfo.packageManager}\n`;
    context += `- Workspace Type: ${analysis.repoInfo.workspaceType}\n`;
    context += `- Languages: ${analysis.repoInfo.languages.join(', ')}\n`;
    context += `- Has TypeScript: ${analysis.repoInfo.hasTypeScript}\n`;
    context += `- Has JavaScript: ${analysis.repoInfo.hasJavaScript}\n\n`;

    // Units summary
    context += '## Documentation Units\n';
    context += `- Total Units: ${analysis.unitsSummary.count}\n`;
    context += `- Unit Types:\n`;
    for (const [type, count] of Object.entries(analysis.unitsSummary.types)) {
      if (count > 0) {
        context += `  - ${type}: ${count}\n`;
      }
    }
    if (analysis.unitsSummary.names.length > 0) {
      context += `- Unit Names: ${analysis.unitsSummary.names.join(', ')}\n`;
    }
    context += '\n';

    // Top-level structure
    context += '## Top-Level Structure\n';
    context += '### Folders\n';
    if (analysis.topLevelStructure.folders.length > 0) {
      context += analysis.topLevelStructure.folders.map(f => `- ${f}/`).join('\n') + '\n';
    } else {
      context += '(none)\n';
    }
    context += '\n### Files\n';
    if (analysis.topLevelStructure.files.length > 0) {
      context += analysis.topLevelStructure.files.map(f => `- ${f}`).join('\n') + '\n';
    } else {
      context += '(none)\n';
    }
    context += '\n';

    // Package.json highlights
    context += '## package.json\n';
    const pkg = analysis.packageJson;
    if (pkg.name) context += `- Name: ${pkg.name}\n`;
    if (pkg.version) context += `- Version: ${pkg.version}\n`;
    if (pkg.description) context += `- Description: ${pkg.description}\n`;
    if (pkg.scripts && typeof pkg.scripts === 'object') {
      const scripts = pkg.scripts as Record<string, string>;
      context += '- Scripts:\n';
      for (const [name, cmd] of Object.entries(scripts)) {
        context += `  - ${name}: ${cmd}\n`;
      }
    }
    context += '\n';

    // Features detected
    context += '## Detected Features\n';
    context += `- Has CI/CD: ${analysis.hasCI}\n`;
    context += `- Has Tests: ${analysis.hasTests}\n`;
    context += `- Is Publishable: ${analysis.hasPublishConfig}\n\n`;

    // Markdown files
    if (analysis.markdownFiles.length > 0) {
      context += '## Markdown Files Found\n';
      for (const md of analysis.markdownFiles) {
        context += `- ${md.path} (${md.size} bytes)\n`;
      }
      context += '\n';
    }

    // README
    if (analysis.readme.exists && analysis.readme.content) {
      context += '## README.md (excerpt)\n';
      context += '```markdown\n';
      context += analysis.readme.content;
      if (analysis.readme.fullSize > analysis.readme.content.length) {
        context += '\n... (truncated)\n';
      }
      context += '\n```\n\n';
    }

    // Source file tree - helps LLM know exactly what files exist
    if (analysis.sourceFileTree && analysis.sourceFileTree.length > 0) {
      context += '## Source Files Available\n';
      context += 'These are the actual source files you can request. Use exact paths:\n';
      context += '```\n';
      context += analysis.sourceFileTree.join('\n');
      context += '\n```\n\n';
    }

    return context;
  }

  /**
   * Create prompt asking LLM if it needs more context
   */
  private createContextRequestPrompt(
    initialContext: string,
    additionalContext: string,
    iteration: number
  ): string {
    return `${initialContext}${additionalContext}

---

You are analyzing this codebase to plan its documentation structure. 

Do you have enough context to make good decisions about what documentation categories are needed, or do you need to see specific files?

If you need more context, respond with JSON:
\`\`\`json
{
  "needsMoreContext": true,
  "requestFile": "path/to/file",
  "reason": "Why you need this file"
}
\`\`\`

If you have enough context, respond with:
\`\`\`json
{
  "needsMoreContext": false,
  "requestFile": null
}
\`\`\`

This is iteration ${iteration}/${this.maxIterations}. Be selective - only request files that are truly needed.

Your response (JSON only):`;
  }

  /**
   * Parse LLM's context request response
   */
  private parseContextRequest(response: string): ContextRequest {
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      const parsed = JSON.parse(jsonStr.trim());

      return {
        needsMoreContext: parsed.needsMoreContext ?? false,
        requestFile: parsed.requestFile ?? null,
        reason: parsed.reason,
      };
    } catch (error) {
      logger.warn('Failed to parse context request, assuming no more context needed:', error);
      return {
        needsMoreContext: false,
        requestFile: null,
      };
    }
  }
}
