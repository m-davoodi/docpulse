import { logger } from '../utils/logger.js';

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries?: number;
  initialRetryDelay?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LLM client with retry logic
 */
export class LLMClient {
  private config: Required<LLMConfig>;

  constructor(config: LLMConfig) {
    this.config = {
      ...config,
      maxRetries: config.maxRetries ?? 3,
      initialRetryDelay: config.initialRetryDelay ?? 1000,
    };
  }

  /**
   * Send a chat completion request
   */
  async complete(
    messages: ChatMessage[],
    options: { temperature?: number; max_tokens?: number } = {}
  ): Promise<string> {
    const request: ChatCompletionRequest = {
      model: this.config.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens,
    };

    const response = await this.makeRequestWithRetry(request);

    if (!response.choices || response.choices.length === 0) {
      throw new Error('No completion choices returned');
    }

    const content = response.choices[0].message.content;

    if (response.usage) {
      logger.debug(
        `LLM usage: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion = ${response.usage.total_tokens} total tokens`
      );
    }

    return content;
  }

  /**
   * Make HTTP request with retry logic
   */
  private async makeRequestWithRetry(
    request: ChatCompletionRequest,
    attempt = 1
  ): Promise<ChatCompletionResponse> {
    try {
      return await this.makeRequest(request);
    } catch (error) {
      // Check if we should retry
      if (attempt >= this.config.maxRetries) {
        logger.error(`LLM request failed after ${attempt} attempts:`, error);
        throw error;
      }

      // Check if error is retryable
      if (!this.isRetryableError(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = this.config.initialRetryDelay * Math.pow(2, attempt - 1);
      logger.warn(`LLM request failed (attempt ${attempt}), retrying in ${delay}ms...`);

      await this.sleep(delay);

      return this.makeRequestWithRetry(request, attempt + 1);
    }
  }

  /**
   * Make HTTP request to LLM API
   */
  private async makeRequest(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;

    logger.debug(`Making LLM request to ${url}`);
    logger.debug(`Model: ${request.model}, Messages: ${request.messages.length}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data as ChatCompletionResponse;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Retry on rate limits and server errors
      if (message.includes('429') || message.includes('rate limit')) {
        return true;
      }

      if (message.includes('500') || message.includes('502') || message.includes('503')) {
        return true;
      }

      // Retry on network errors
      if (
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('network')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create LLM client from config
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  // Validate config
  if (!config.baseUrl) {
    throw new Error('LLM baseUrl is required');
  }

  if (!config.apiKey) {
    throw new Error('LLM apiKey is required');
  }

  if (!config.model) {
    throw new Error('LLM model is required');
  }

  logger.debug(`Creating LLM client: ${config.model} at ${config.baseUrl}`);

  return new LLMClient(config);
}
