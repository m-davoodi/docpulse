import type { FileDiff } from '../../git/diff.js';

export interface UpdateContext {
  docPath: string;
  existingContent: string;
  changedFiles: string[];
  diffs?: FileDiff[];
  conventions?: string;
}

/**
 * Generate prompt for updating existing documentation
 */
export function generateUpdatePrompt(context: UpdateContext): string {
  const { docPath, existingContent, changedFiles, diffs, conventions } = context;

  let prompt = `Update the documentation file: ${docPath}\n\n`;

  // Add conventions if available
  if (conventions) {
    prompt += `## Documentation Conventions\n\n`;
    prompt += `${conventions}\n\n`;
  }

  prompt += `## Existing Documentation\n\n`;
  prompt += `\`\`\`markdown\n${existingContent}\n\`\`\`\n\n`;

  prompt += `## Changed Files\n\n`;
  for (const file of changedFiles) {
    prompt += `- ${file}\n`;
  }
  prompt += '\n';

  // Add diffs if available
  if (diffs && diffs.length > 0) {
    prompt += `## Code Changes\n\n`;

    for (const diff of diffs) {
      prompt += `### ${diff.path}\n\n`;
      prompt += `+${diff.additions} additions, -${diff.deletions} deletions\n\n`;

      // Show first few hunks
      const shownHunks = diff.hunks.slice(0, 3);
      for (const hunk of shownHunks) {
        prompt += `\`\`\`diff\n`;
        prompt += hunk.lines.slice(0, 20).join('\n');
        if (hunk.lines.length > 20) {
          prompt += `\n... (${hunk.lines.length - 20} more lines)\n`;
        }
        prompt += `\n\`\`\`\n\n`;
      }

      if (diff.hunks.length > 3) {
        prompt += `... and ${diff.hunks.length - 3} more hunks\n\n`;
      }
    }
  }

  prompt += `## Task\n\n`;
  prompt += `Update the documentation based on the code changes:\n\n`;
  prompt += `1. Identify which sections are affected by the changes\n`;
  prompt += `2. Update only the affected sections\n`;
  prompt += `3. Maintain the existing structure and style\n`;
  prompt += `4. Follow the conventions in docs/index.md\n`;
  prompt += `5. Add TODO markers for anything you cannot verify\n\n`;

  prompt += `Return the complete updated documentation in Markdown format.\n`;

  return prompt;
}
