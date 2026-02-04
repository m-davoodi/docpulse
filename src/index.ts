import { Command } from 'commander';
import { config } from 'dotenv';
import { logger } from './utils/logger.js';
import { createInitCommand } from './commands/init.js';
import { createUpdateCommand } from './commands/update.js';
import { createStatusCommand } from './commands/status.js';
import { createPlanCommand } from './commands/plan.js';

// Load environment variables
config();

const program = new Command();

program
  .name('docpulse')
  .description('LLM-assisted documentation that stays up to date')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress non-error output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      logger.setVerbose(true);
    }
    if (opts.quiet) {
      logger.setQuiet(true);
    }
  });

// Add commands
program.addCommand(createInitCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createStatusCommand());
program.addCommand(createPlanCommand());

// Parse arguments
program.parse();
