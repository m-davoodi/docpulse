import { logger } from '../utils/logger.js';

/**
 * Patterns that might contain secrets
 */
const SECRET_PATTERNS = [
  // API keys
  /api[_-]?key[_-]?=\s*['"]([a-zA-Z0-9_\-]{20,})['"]/gi,
  /bearer\s+([a-zA-Z0-9_\-\.]{20,})/gi,
  
  // Tokens
  /token[_-]?=\s*['"]([a-zA-Z0-9_\-]{20,})['"]/gi,
  /access[_-]?token[_-]?=\s*['"]([a-zA-Z0-9_\-]{20,})['"]/gi,
  
  // AWS keys
  /AKIA[0-9A-Z]{16}/gi,
  
  // Private keys
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
  
  // Database URLs with passwords
  /:\/\/[^:]+:([^@]+)@/gi,
  
  // Generic secret patterns
  /secret[_-]?=\s*['"]([^'"]{8,})['"]/gi,
  /password[_-]?=\s*['"]([^'"]{8,})['"]/gi,
];

/**
 * File extensions that commonly contain secrets
 */
const SECRET_FILE_EXTENSIONS = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  'credentials.json',
  'credentials.yml',
  'secrets.json',
  'secrets.yml',
];

/**
 * Redact potential secrets from text
 */
export function redactSecrets(text: string): string {
  let redacted = text;
  let foundSecrets = false;

  for (const pattern of SECRET_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        // Redact the captured group (the actual secret)
        redacted = redacted.replace(match[1], '[REDACTED]');
        foundSecrets = true;
      } else {
        // Redact the whole match if no capture group
        redacted = redacted.replace(match[0], '[REDACTED]');
        foundSecrets = true;
      }
    }
  }

  if (foundSecrets) {
    logger.warn('Redacted potential secrets from content');
  }

  return redacted;
}

/**
 * Check if a file should be excluded due to likely containing secrets
 */
export function shouldExcludeFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();

  for (const ext of SECRET_FILE_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) {
      logger.warn(`Excluding file that may contain secrets: ${filePath}`);
      return true;
    }
  }

  return false;
}

/**
 * Redact secrets from file content
 */
export function redactFileContent(filePath: string, content: string): string {
  // If the file should be excluded entirely, return a placeholder
  if (shouldExcludeFile(filePath)) {
    return '[File excluded - may contain secrets]';
  }

  // Otherwise, redact any secrets in the content
  return redactSecrets(content);
}
