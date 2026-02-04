# DocPulse

LLM-assisted documentation that stays up to date.

## Overview

DocPulse is a Node.js CLI tool that bootstraps and maintains documentation for JavaScript/TypeScript repositories. It uses LLMs to generate documentation and automatically updates only the docs affected by code changes.

## Key Features

- **Automatic Documentation**: Generate documentation from your codebase
- **Incremental Updates**: Only update docs affected by changes
- **Dependency-Aware**: Tracks dependencies to find impacted documentation
- **Git-Integrated**: Uses git history to detect changes
- **Evidence-Based**: LLM documents only what it can verify from code
- **Monorepo Support**: Handles both single packages and monorepos

## How It Works

DocPulse solves two hard problems:

1. **Scale/Context Limits**: Uses map-reduce approach with bounded context windows
2. **Dependency Blindness**: Builds dependency graph to find impacted files

### First Run (`init`)
- Discovers repository structure
- Partitions into documentation units
- Creates docs/ folder with structure
- Generates initial documentation
- Creates manifest for state tracking

### Subsequent Runs (`update`)
- Computes git diff since last run
- Builds dependency graph
- Finds impacted documentation
- Updates only affected docs
- Maintains consistency with conventions

## Installation

```bash
npm install -g docpulse
# or
pnpm add -g docpulse
# or
yarn global add docpulse
```

## Quick Start

### 1. Configure LLM API

Create `docpulse.config.json` in your repository root:

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "${OPENAI_API_KEY}"
  }
}
```

Or set environment variable:

```bash
export OPENAI_API_KEY="your-api-key"
```

### 2. Initialize Documentation

```bash
cd your-repo
docpulse init
```

This creates:
```
docs/
├── index.md              # Documentation conventions
├── .manifest.json        # State and metadata
├── architecture/
│   └── index.md
└── how-to/
    └── index.md
```

### 3. Update Documentation

After making code changes:

```bash
docpulse update
```

## Commands

### `docpulse init`

Bootstrap documentation for the repository.

**Options:**
- `--interactive`: Run in interactive mode (future feature)
- `--dry-run`: Preview what would be created
- `-v, --verbose`: Enable verbose logging
- `-q, --quiet`: Suppress non-error output

**Example:**
```bash
docpulse init --dry-run  # Preview
docpulse init            # Create docs
```

### `docpulse update`

Update documentation based on code changes.

**Options:**
- `--since <commit>`: Override baseline commit
- `--dry-run`: Preview updates without writing
- `-v, --verbose`: Enable verbose logging

**Example:**
```bash
docpulse update              # Update from last run
docpulse update --since HEAD~5  # Update from 5 commits ago
docpulse update --dry-run    # Preview changes
```

### `docpulse status`

Show documentation status and last run information.

**Example:**
```bash
docpulse status
```

**Output includes:**
- Repository information
- Git state
- Last successful run
- Documentation coverage

### `docpulse plan`

Show which documents would be updated (preview for update).

**Options:**
- `--since <commit>`: Compare against specific commit

**Example:**
```bash
docpulse plan                # Plan from last run
docpulse plan --since abc123 # Plan from specific commit
```

## Configuration

### Config File: `docpulse.config.json`

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "${OPENAI_API_KEY}"
  },
  "docs": {
    "root": "docs",
    "templates": {}
  },
  "ignore": [
    "node_modules/**",
    "dist/**",
    "build/**"
  ]
}
```

### Environment Variables

- `OPENAI_API_KEY`: OpenAI API key (or other OpenAI-compatible API)
- Environment variables can be referenced in config with `${VAR_NAME}` syntax

### LLM Providers

DocPulse works with any OpenAI-compatible API:

#### OpenAI
```json
{
  "llm": {
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o",
    "apiKey": "${OPENAI_API_KEY}"
  }
}
```

#### Local Models (Ollama, LM Studio, etc.)
```json
{
  "llm": {
    "baseUrl": "http://localhost:11434/v1",
    "model": "llama2",
    "apiKey": "not-needed"
  }
}
```

#### Anthropic (via proxy)
Use a proxy that converts Anthropic API to OpenAI format.

## Project Structure

```
your-repo/
├── docs/                    # Generated documentation
│   ├── index.md             # Conventions (how docs are organized)
│   ├── .manifest.json       # State and metadata
│   ├── architecture/        # Cross-cutting docs
│   ├── how-to/              # Guides and playbooks
│   └── packages/            # Per-package docs (monorepos)
├── docpulse.config.json     # Configuration (optional)
└── [your source code]
```

## Manifest File

The `.manifest.json` tracks:
- Repository metadata
- Documentation units
- Coverage map (source files → docs)
- Run history
- Last successful commit

**Example:**
```json
{
  "schemaVersion": 1,
  "tool": { "name": "docpulse", "version": "0.1.0" },
  "repo": {
    "detected": {
      "packageManager": "pnpm",
      "workspace": "monorepo",
      "languages": ["ts", "js"]
    }
  },
  "runs": {
    "lastSuccessful": {
      "timestamp": "2026-02-04T12:00:00.000Z",
      "gitCommit": "abc123"
    }
  },
  "coverageMap": [
    {
      "doc": "docs/packages/foo.md",
      "covers": ["packages/foo/**/*"]
    }
  ]
}
```

## Documentation Conventions

DocPulse follows these principles:

1. **Evidence-based**: Only document what can be verified from code
2. **TODO markers**: Flag uncertainties with "TODO: verify"
3. **Consistency**: Follow conventions in docs/index.md
4. **Bounded scope**: Only modify files in allowed list
5. **Incremental**: Update only affected sections

## Dependency Tracking

DocPulse builds a dependency graph to understand:
- What each file imports
- What files depend on each file
- Transitive dependencies

When you change a file, DocPulse updates:
- Documentation for that file
- Documentation for files that depend on it

## Use Cases

### Weekly Documentation Updates
```bash
# In CI or locally
docpulse update
git add docs/
git commit -m "docs: update documentation"
```

### Pre-commit Documentation Check
```bash
# In pre-commit hook
docpulse plan --since HEAD~1
```

### Documentation-as-Code Reviews
```bash
# Review what would change
docpulse plan --since main
docpulse update --dry-run
```

## Development

### Requirements
- Node.js >= 18
- pnpm (recommended)
- Git repository

### Build
```bash
pnpm install
pnpm build
```

### Test
```bash
pnpm test
```

### Local Development
```bash
pnpm build
node dist/index.js --help
```

## Architecture

DocPulse consists of several modules:

- **scan/**: Repository discovery and structure detection
- **git/**: Git operations (diff, state, validation)
- **graph/**: Dependency graph (Tree-sitter parsing)
- **manifest/**: State management and coverage mapping
- **llm/**: LLM client and prompting
- **commands/**: CLI command implementations

See `checkpoints/` folder for detailed implementation notes.

## Limitations

- Focuses on JavaScript/TypeScript repositories
- Requires git repository
- Dependency graph is import-based (runtime deps not tracked)
- LLM context windows limit unit size
- Tree-sitter native modules may need rebuild on different platforms

## Roadmap

- [ ] Streaming LLM responses
- [ ] Support for more languages (Python, Go, Rust)
- [ ] Better monorepo workspace detection
- [ ] Custom doc templates
- [ ] Interactive init mode
- [ ] CI/CD integrations
- [ ] Documentation quality metrics

## License

MIT

## Contributing

Contributions welcome! Please:
1. Check existing issues
2. Create a feature branch
3. Add tests for new features
4. Update documentation
5. Submit a pull request

## Support

- Issues: https://github.com/yourusername/docpulse/issues
- Documentation: See `docs/` folder after running init

## Credits

Built with:
- Commander.js (CLI framework)
- Tree-sitter (code parsing)
- Zod (schema validation)
- TypeScript (type safety)
- Vitest (testing)
