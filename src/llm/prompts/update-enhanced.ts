import { BASE_SYSTEM_PROMPT } from './system.js';
import type { CategoryUpdatePlan } from '../../commands/update-helpers.js';
import type { UpdateContextResult } from '../update-context-provider.js';
import type { FileDiff } from '../../git/diff.js';

/**
 * Enhanced system prompt for documentation updates
 */
export const ENHANCED_UPDATE_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Task: Update documentation for a specific category based on code changes.

Update Strategy:
1. **Identify affected sections**: Determine which parts of the documentation are impacted by the changes
2. **Surgical updates**: Update ONLY the affected sections, leave other sections intact
3. **Reference changes**: Explicitly reference specific code changes in your updates
4. **Evidence-based**: Base updates on the provided code diffs and file contents
5. **TODO markers**: Use "TODO: verify [detail]" for anything uncertain or requiring further investigation
6. **Maintain structure**: Keep the existing section headings and overall organization unless the changes require restructuring
7. **Preserve intent**: Maintain the category's original purpose and scope

Output Requirements:
- Return the complete updated document in Markdown format
- Keep existing sections that aren't affected by the changes
- Add code file references where relevant (e.g., "see src/commands/init.ts")
- Use clear, concise language appropriate for developers`;

/**
 * Create update prompt for a specific category
 */
export function createCategoryUpdatePrompt(
  plan: CategoryUpdatePlan,
  existingDoc: string,
  context: UpdateContextResult,
  conventions: string
): string {
  let prompt = `Update the documentation for the "${plan.category}" category based on code changes.

`;

  // Category context
  prompt += `## Category Information\n\n`;
  prompt += `**Category**: ${plan.category}\n`;
  prompt += `**Update Reason**: ${plan.reason}\n`;
  if (plan.topics.length > 0) {
    prompt += `**Expected Topics**: ${plan.topics.join(', ')}\n`;
  }
  prompt += '\n';

  // Current documentation
  prompt += `## Current Documentation\n\n`;
  prompt += '```markdown\n';
  prompt += existingDoc;
  prompt += '\n```\n\n';

  // Context from context provider
  prompt += context.fullContext;
  prompt += '\n';

  // Conventions
  if (conventions) {
    prompt += `## Documentation Conventions\n\n`;
    prompt += conventions;
    prompt += '\n\n';
  }

  // Task instructions
  prompt += `## Your Task\n\n`;
  prompt += `Analyze the code changes and update the documentation accordingly:\n\n`;
  prompt += `1. Review the current documentation and identify which sections are affected by the changes\n`;
  prompt += `2. Update those sections with accurate information based on the code changes\n`;
  prompt += `3. Keep sections that aren't affected by the changes unchanged\n`;
  prompt += `4. Add new sections if the changes introduce new concepts or features\n`;
  prompt += `5. Remove or mark as deprecated any sections that are no longer relevant\n`;
  prompt += `6. Ensure the updated documentation follows the conventions defined above\n\n`;

  if (context.requestedFiles.length > 0) {
    prompt += `**Note**: You requested and received these additional files for context:\n`;
    prompt += context.requestedFiles.map(f => `- ${f}`).join('\n');
    prompt += '\n\n';
  }

  prompt += `Return the complete updated documentation in Markdown format (no code block wrappers):\n`;

  return prompt;
}

/**
 * Format diffs for prompt with truncation
 */
export function formatDiffsForPrompt(
  diffs: FileDiff[],
  maxLinesPerFile = 20
): string {
  let formatted = '';

  for (const diff of diffs) {
    formatted += `### ${diff.path}\n\n`;
    formatted += `+${diff.additions} additions, -${diff.deletions} deletions\n\n`;

    for (const hunk of diff.hunks) {
      const lines = hunk.lines.slice(0, maxLinesPerFile);
      formatted += '```diff\n';
      formatted += lines.join('\n');
      
      if (hunk.lines.length > maxLinesPerFile) {
        formatted += `\n... (${hunk.lines.length - maxLinesPerFile} more lines)\n`;
      }
      
      formatted += '\n```\n\n';
    }
  }

  return formatted;
}

/**
 * Create a concise summary of changes for logging
 */
export function summarizeChanges(diffs: FileDiff[]): string {
  const totalFiles = diffs.length;
  const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0);
  const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0);

  return `${totalFiles} file${totalFiles > 1 ? 's' : ''} changed: +${totalAdditions} -${totalDeletions}`;
}
