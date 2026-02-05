import { BASE_SYSTEM_PROMPT } from './system.js';

/**
 * System prompt for structure planning
 */
export const STRUCTURE_PLANNING_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Task: Analyze a codebase and decide which documentation categories are needed.

REQUIRED minimum categories:
- architecture: Cross-cutting architectural documentation
- how-to: Step-by-step guides for common tasks
- onboarding: Getting started guides, new developer setup, project introduction

OPTIONAL categories (only create if evidence exists):
- api: Public APIs, library interfaces, SDK documentation
- release: Release process, publishing, versioning, changelog management
- contributing: Contribution guidelines, setup for contributors, PR process
- deployment: Deployment procedures, infrastructure, environments
- testing: Testing strategy, running tests, writing tests
- troubleshooting: Common issues, debugging, FAQ

For each category you decide to create:
1. Explain WHY it's needed (cite evidence from the codebase)
2. List 3-5 initial topics to cover

Output format (JSON only, no other text):
{
  "categories": [
    {
      "name": "architecture",
      "reason": "Complex CLI tool with 6 modules (scan, git, graph, manifest, llm, commands)",
      "topics": ["Module structure", "Dependency graph", "LLM integration"]
    },
    {
      "name": "how-to",
      "reason": "CLI tool that developers will use - needs practical guides",
      "topics": ["Adding commands", "Running locally", "Writing tests"]
    }
  ]
}

Be selective - only create categories where you have clear evidence they are needed.`;

/**
 * Create user prompt for structure planning
 */
export function createStructurePlanningPrompt(
  fullContext: string,
  requestedFiles: string[]
): string {
  let prompt = fullContext;

  if (requestedFiles.length > 0) {
    prompt += `\n\n---\n\nYou requested and received these additional files:\n`;
    prompt += requestedFiles.map(f => `- ${f}`).join('\n');
    prompt += '\n';
  }

  prompt += `\n---

Based on the project analysis above, decide which documentation categories are needed.

Remember:
- ALWAYS include: architecture, how-to, onboarding
- ADD optional categories ONLY if you have clear evidence
- Provide specific reasons citing what you see in the codebase
- List concrete topics to document in each category

Respond with JSON only (no markdown code blocks, no other text):`;

  return prompt;
}

/**
 * Format structure planning response
 */
export interface DocCategory {
  name: string;
  reason: string;
  topics: string[];
}

export interface StructurePlanningResponse {
  categories: DocCategory[];
}

/**
 * Parse structure planning response from LLM
 */
export function parseStructurePlanningResponse(response: string): StructurePlanningResponse {
  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : response;

  const parsed = JSON.parse(jsonStr.trim());

  // Validate structure
  if (!parsed.categories || !Array.isArray(parsed.categories)) {
    throw new Error('Invalid structure planning response: missing categories array');
  }

  // Ensure minimum categories exist
  const categoryNames = new Set(parsed.categories.map((c: DocCategory) => c.name));
  const missingRequired: string[] = [];

  if (!categoryNames.has('architecture')) {
    missingRequired.push('architecture');
  }
  if (!categoryNames.has('how-to')) {
    missingRequired.push('how-to');
  }
  if (!categoryNames.has('onboarding')) {
    missingRequired.push('onboarding');
  }

  // Add missing required categories
  if (missingRequired.length > 0) {
    for (const name of missingRequired) {
      parsed.categories.push({
        name,
        reason: 'Required minimum category',
        topics: [],
      });
    }
  }

  return parsed as StructurePlanningResponse;
}
