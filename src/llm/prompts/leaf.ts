import type { Unit } from '../../scan/units.js';

export interface LeafAnalysisContext {
  unit: Unit;
  files: string[];
  entryPointContent?: string;
  readmeContent?: string;
  packageJsonContent?: string;
}

/**
 * Generate prompt for leaf analysis (documenting a single unit)
 */
export function generateLeafPrompt(context: LeafAnalysisContext): string {
  const { unit, files, entryPointContent, readmeContent, packageJsonContent } = context;

  let prompt = `Document the following ${unit.kind}:\n\n`;

  prompt += `**Unit ID**: ${unit.id}\n`;
  prompt += `**Name**: ${unit.name}\n`;
  prompt += `**Path**: ${unit.relativePath}\n`;
  prompt += `**Kind**: ${unit.kind}\n\n`;

  // Add package.json if available
  if (packageJsonContent) {
    prompt += `## package.json\n\n\`\`\`json\n${packageJsonContent}\n\`\`\`\n\n`;
  }

  // Add README if available
  if (readmeContent) {
    prompt += `## Existing README\n\n${readmeContent}\n\n`;
  }

  // Add entry point content if available
  if (entryPointContent) {
    prompt += `## Main Entry Point\n\n\`\`\`typescript\n${entryPointContent}\n\`\`\`\n\n`;
  }

  // List files
  prompt += `## Files in this unit (${files.length} total)\n\n`;
  const listedFiles = files.slice(0, 50);
  for (const file of listedFiles) {
    prompt += `- ${file}\n`;
  }
  if (files.length > 50) {
    prompt += `... and ${files.length - 50} more files\n`;
  }
  prompt += '\n';

  // Instructions
  prompt += `## Documentation Requirements\n\n`;
  prompt += `Create documentation that includes:\n\n`;
  prompt += `1. **Overview**: What is this ${unit.kind} and what does it do?\n`;
  prompt += `2. **Purpose**: Why does this exist? What problem does it solve?\n`;
  prompt += `3. **Entry Points**: Main exports, public API, or entry files\n`;
  prompt += `4. **Dependencies**: What does this depend on?\n`;
  prompt += `5. **Usage**: How to use, build, test, or run this ${unit.kind}\n`;
  prompt += `6. **Notes**: Any important patterns, conventions, or gotchas\n\n`;

  prompt += `Write the documentation in Markdown format.\n`;
  prompt += `If you cannot verify something from the provided evidence, write "TODO: verify [reason]".\n`;

  return prompt;
}
