import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';
import type { LLMClient } from './client.js';
import type { FileDiff } from '../git/diff.js';
import type { CategoryUpdatePlan } from '../commands/update-helpers.js';

export interface ContextRequest {
  needsMoreContext: boolean;
  requestFile: string | null;
  reason?: string;
}

export interface UpdateContextResult {
  fullContext: string;
  requestedFiles: string[];
}

/**
 * Interactive context provider for update operations
 */
export class UpdateContextProvider {
  private providedFiles: Set<string> = new Set();
  private maxIterations = 5;
  private maxFileSize = 10000; // 10KB per file

  /**
   * Gather context for updating documentation
   */
  async gatherUpdateContext(
    llmClient: LLMClient,
    plan: CategoryUpdatePlan,
    existingDoc: string,
    diffs: FileDiff[],
    cwd: string
  ): Promise<UpdateContextResult> {
    logger.debug(`Gathering context for ${plan.category} update...`);

    const requestedFiles: string[] = [];
    let additionalContext = '';
    let iteration = 0;

    // Format initial context
    const initialContext = this.formatInitialContext(
      plan,
      existingDoc,
      diffs
    );

    while (iteration < this.maxIterations) {
      iteration++;
      logger.debug(`Context gathering iteration ${iteration}/${this.maxIterations}`);

      // Ask LLM if it needs more context
      const prompt = this.createContextRequestPrompt(
        initialContext,
        additionalContext,
        iteration
      );

      try {
        const response = await llmClient.complete(
          [
            {
              role: 'system',
              content: 'You are analyzing code changes to update documentation. You can request specific files to better understand the changes.',
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
          additionalContext += `\n\n--- Current File: ${request.requestFile} ---\n${fileContent}\n`;
          logger.debug(`Provided file: ${request.requestFile} (${fileContent.length} chars)`);
        } else {
          logger.warn(`Could not provide file: ${request.requestFile}`);
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

    const fullContext = initialContext + additionalContext;
    logger.success(`Context gathering complete: ${requestedFiles.length} additional files`);

    return {
      fullContext,
      requestedFiles,
    };
  }

  /**
   * Format initial context for LLM
   */
  private formatInitialContext(
    plan: CategoryUpdatePlan,
    existingDoc: string,
    diffs: FileDiff[]
  ): string {
    let context = `# Documentation Update Context\n\n`;

    // Category info
    context += `## Category: ${plan.category}\n\n`;
    context += `**Update Reason**: ${plan.reason}\n`;
    if (plan.topics.length > 0) {
      context += `**Topics**: ${plan.topics.join(', ')}\n`;
    }
    context += '\n';

    // Existing documentation
    context += `## Current Documentation\n\n`;
    context += '```markdown\n';
    context += existingDoc;
    context += '\n```\n\n';

    // Impacted files list
    context += `## Impacted Files (${plan.impactedFiles.length})\n\n`;
    for (const file of plan.impactedFiles.slice(0, 20)) {
      context += `- ${file}\n`;
    }
    if (plan.impactedFiles.length > 20) {
      context += `... and ${plan.impactedFiles.length - 20} more files\n`;
    }
    context += '\n';

    // Code changes (git diffs)
    if (diffs.length > 0) {
      context += `## Code Changes\n\n`;
      
      for (const diff of diffs.slice(0, 10)) {
        context += `### ${diff.path}\n\n`;
        context += `**Changes**: +${diff.additions} additions, -${diff.deletions} deletions\n\n`;

        // Show truncated hunks
        const shownHunks = diff.hunks.slice(0, 2);
        for (const hunk of shownHunks) {
          const lines = hunk.lines.slice(0, 15);
          context += '```diff\n';
          context += lines.join('\n');
          if (hunk.lines.length > 15) {
            context += `\n... (${hunk.lines.length - 15} more lines)`;
          }
          context += '\n```\n\n';
        }

        if (diff.hunks.length > 2) {
          context += `... and ${diff.hunks.length - 2} more hunks\n\n`;
        }
      }

      if (diffs.length > 10) {
        context += `... and ${diffs.length - 10} more changed files\n\n`;
      }
    } else {
      context += `## Code Changes\n\nNo detailed diffs available.\n\n`;
    }

    return context;
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
   * Create prompt asking LLM if it needs more context
   */
  private createContextRequestPrompt(
    initialContext: string,
    additionalContext: string,
    iteration: number
  ): string {
    return `${initialContext}${additionalContext}

---

You are analyzing these code changes to update the documentation.

Do you have enough context to update the documentation effectively, or do you need to see specific files' current content?

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

This is iteration ${iteration}/${this.maxIterations}. Be selective - only request files that are truly needed to understand the changes and update the documentation accurately.

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
