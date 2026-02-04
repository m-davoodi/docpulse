import { describe, it, expect } from 'vitest';
import { shouldIgnore, DEFAULT_IGNORE_PATTERNS } from '../scan/ignore.js';

describe('Ignore Rules', () => {
  describe('shouldIgnore', () => {
    it('should ignore node_modules', () => {
      const patterns = ['node_modules/**', '**/node_modules/**'];
      expect(shouldIgnore('node_modules/package/index.js', patterns)).toBe(true);
      expect(shouldIgnore('src/node_modules/test.js', patterns)).toBe(true);
    });

    it('should ignore dist directory', () => {
      expect(shouldIgnore('dist/index.js', DEFAULT_IGNORE_PATTERNS)).toBe(true);
      expect(shouldIgnore('dist/bundle/main.js', DEFAULT_IGNORE_PATTERNS)).toBe(true);
    });

    it('should ignore build directory', () => {
      expect(shouldIgnore('build/output.js', DEFAULT_IGNORE_PATTERNS)).toBe(true);
    });

    it('should ignore coverage directory', () => {
      expect(shouldIgnore('coverage/lcov-report/index.html', DEFAULT_IGNORE_PATTERNS)).toBe(true);
    });

    it('should ignore minified files', () => {
      expect(shouldIgnore('src/vendor.min.js', DEFAULT_IGNORE_PATTERNS)).toBe(true);
      expect(shouldIgnore('styles/app.min.css', DEFAULT_IGNORE_PATTERNS)).toBe(true);
    });

    it('should not ignore regular source files', () => {
      expect(shouldIgnore('src/index.ts', DEFAULT_IGNORE_PATTERNS)).toBe(false);
      expect(shouldIgnore('src/utils/helper.js', DEFAULT_IGNORE_PATTERNS)).toBe(false);
      expect(shouldIgnore('README.md', DEFAULT_IGNORE_PATTERNS)).toBe(false);
    });

    it('should handle custom patterns', () => {
      const patterns = ['test/**', '*.log'];
      expect(shouldIgnore('test/unit.spec.ts', patterns)).toBe(true);
      expect(shouldIgnore('debug.log', patterns)).toBe(true);
      expect(shouldIgnore('src/main.ts', patterns)).toBe(false);
    });
  });
});
