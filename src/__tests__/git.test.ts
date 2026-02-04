import { describe, it, expect } from 'vitest';
import { validateGitRepository } from '../git/validate.js';

describe('Git Integration', () => {
  describe('validateGitRepository', () => {
    it('should validate the docpulse repository', async () => {
      // Test on the current repository (docpulse itself)
      const result = await validateGitRepository(process.cwd());

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for non-git directory', async () => {
      const result = await validateGitRepository('/tmp');

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
