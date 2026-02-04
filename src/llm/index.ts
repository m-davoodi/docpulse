export { LLMClient, createLLMClient, type LLMConfig, type ChatMessage } from './client.js';

export {
  BASE_SYSTEM_PROMPT,
  LEAF_ANALYSIS_SYSTEM_PROMPT,
  REDUCTION_SYSTEM_PROMPT,
  UPDATE_SYSTEM_PROMPT,
  CONVENTIONS_SYSTEM_PROMPT,
} from './prompts/system.js';

export { generateLeafPrompt, type LeafAnalysisContext } from './prompts/leaf.js';
export { generateReducePrompt, type ReduceContext } from './prompts/reduce.js';
export { generateUpdatePrompt, type UpdateContext } from './prompts/update.js';

export { redactSecrets, shouldExcludeFile, redactFileContent } from './redact.js';
