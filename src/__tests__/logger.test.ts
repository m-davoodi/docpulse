import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../utils/logger.js';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    logger = new Logger();
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  it('should log info messages by default', () => {
    logger.info('test message');
    expect(consoleSpy.log).toHaveBeenCalledWith('test message');
  });

  it('should not log when quiet mode is enabled', () => {
    logger.setQuiet(true);
    logger.info('test message');
    expect(consoleSpy.log).not.toHaveBeenCalled();
  });

  it('should log debug messages only in verbose mode', () => {
    logger.debug('debug message');
    expect(consoleSpy.log).not.toHaveBeenCalled();

    logger.setVerbose(true);
    logger.debug('debug message');
    expect(consoleSpy.log).toHaveBeenCalledWith('[DEBUG] debug message');
  });

  it('should always log error messages', () => {
    logger.setQuiet(true);
    logger.error('error message');
    expect(consoleSpy.error).toHaveBeenCalledWith('✗ error message');
  });
});
