export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

/**
 * Logger class for consistent output formatting
 */
export class Logger {
  private verbose = false;
  private quiet = false;

  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  setQuiet(quiet: boolean) {
    this.quiet = quiet;
  }

  info(message: string, ...args: unknown[]) {
    if (!this.quiet) {
      console.log(message, ...args);
    }
  }

  success(message: string, ...args: unknown[]) {
    if (!this.quiet) {
      console.log(`✓ ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]) {
    if (!this.quiet) {
      console.warn(`⚠ ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]) {
    console.error(`✗ ${message}`, ...args);
  }

  debug(message: string, ...args: unknown[]) {
    if (this.verbose) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }
}

export const logger = new Logger();
