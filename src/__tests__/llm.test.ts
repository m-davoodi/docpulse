import { describe, it, expect } from 'vitest';
import { redactSecrets, shouldExcludeFile, redactFileContent } from '../llm/redact.js';
import { generateLeafPrompt, generateUpdatePrompt } from '../llm/index.js';

describe('LLM Module', () => {
  describe('redactSecrets', () => {
    it('should redact API keys', () => {
      const text = 'api_key="sk-1234567890abcdefghijklmnopqrstuvwxyz"';
      const redacted = redactSecrets(text);
      
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('sk-1234567890abcdefghijklmnopqrstuvwxyz');
    });

    it('should redact bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const redacted = redactSecrets(text);
      
      expect(redacted).toContain('[REDACTED]');
    });

    it('should not redact normal text', () => {
      const text = 'This is a normal string with no secrets';
      const redacted = redactSecrets(text);
      
      expect(redacted).toBe(text);
    });
  });

  describe('shouldExcludeFile', () => {
    it('should exclude .env files', () => {
      expect(shouldExcludeFile('.env')).toBe(true);
      expect(shouldExcludeFile('.env.local')).toBe(true);
      expect(shouldExcludeFile('config/.env')).toBe(true);
    });

    it('should exclude credential files', () => {
      expect(shouldExcludeFile('credentials.json')).toBe(true);
      expect(shouldExcludeFile('secrets.yml')).toBe(true);
    });

    it('should not exclude normal source files', () => {
      expect(shouldExcludeFile('src/index.ts')).toBe(false);
      expect(shouldExcludeFile('README.md')).toBe(false);
    });
  });

  describe('redactFileContent', () => {
    it('should redact entire content for excluded files', () => {
      const content = 'API_KEY=secret123';
      const redacted = redactFileContent('.env', content);
      
      expect(redacted).toBe('[File excluded - may contain secrets]');
    });

    it('should redact secrets in non-excluded files', () => {
      const content = 'token="abc123def456ghi789jkl012mno345"';
      const redacted = redactFileContent('src/config.ts', content);
      
      expect(redacted).toContain('[REDACTED]');
    });
  });

  describe('generateLeafPrompt', () => {
    it('should generate a leaf analysis prompt', () => {
      const prompt = generateLeafPrompt({
        unit: {
          id: 'test-unit',
          kind: 'package',
          path: '/test/path',
          relativePath: 'packages/test',
          name: 'test-package',
          doc: 'docs/packages/test.md',
          entrypoints: ['index.ts'],
        },
        files: ['index.ts', 'utils.ts'],
        packageJsonContent: '{ "name": "test-package" }',
      });

      expect(prompt).toContain('test-package');
      expect(prompt).toContain('package.json');
      expect(prompt).toContain('index.ts');
    });
  });

  describe('generateUpdatePrompt', () => {
    it('should generate an update prompt', () => {
      const prompt = generateUpdatePrompt({
        docPath: 'docs/test.md',
        existingContent: '# Test Doc\n\nThis is a test.',
        changedFiles: ['src/index.ts'],
        conventions: 'Follow these conventions...',
      });

      expect(prompt).toContain('docs/test.md');
      expect(prompt).toContain('This is a test');
      expect(prompt).toContain('src/index.ts');
      expect(prompt).toContain('conventions');
    });
  });
});
