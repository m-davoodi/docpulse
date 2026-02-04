export interface ReduceContext {
  title: string;
  childDocs: Array<{
    path: string;
    content: string;
  }>;
  purpose: string;
}

/**
 * Generate prompt for reduction (summarizing multiple docs)
 */
export function generateReducePrompt(context: ReduceContext): string {
  const { title, childDocs, purpose } = context;

  let prompt = `Create a summary document: ${title}\n\n`;

  prompt += `**Purpose**: ${purpose}\n\n`;

  prompt += `## Child Documents\n\n`;

  for (const doc of childDocs) {
    prompt += `### ${doc.path}\n\n`;
    prompt += `${doc.content}\n\n`;
    prompt += `---\n\n`;
  }

  prompt += `## Task\n\n`;
  prompt += `Create an index/summary document that:\n\n`;
  prompt += `1. Provides an overview of the documents listed above\n`;
  prompt += `2. Explains how they relate to each other\n`;
  prompt += `3. Links to each child document\n`;
  prompt += `4. Highlights cross-cutting themes or patterns\n`;
  prompt += `5. Keeps it concise (don't repeat all details from child docs)\n\n`;

  prompt += `Write the summary in Markdown format.\n`;

  return prompt;
}
