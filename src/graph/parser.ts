import { init, parse } from 'es-module-lexer';
import { readFile } from 'fs/promises';
import { logger } from '../utils/logger.js';

export interface ImportInfo {
  source: string; // The import source (e.g., './utils', 'lodash')
  specifiers: string[]; // What's being imported (e.g., ['default'], ['foo', 'bar'])
  isNamespace: boolean; // import * as foo
  isDynamic: boolean; // import('...')
}

export interface ExportInfo {
  source?: string; // For re-exports (export { x } from './y')
  specifiers: string[]; // What's being exported
  isNamespace: boolean; // export * from
  isDefault: boolean; // export default
}

export interface ModuleInfo {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
}

// Track initialization state
let initialized = false;

/**
 * Ensure es-module-lexer is initialized (must be called before parsing)
 */
async function ensureInit(): Promise<void> {
  if (!initialized) {
    await init;
    initialized = true;
  }
}

/**
 * Parse a JavaScript or TypeScript file and extract imports/exports
 */
export async function parseFile(filePath: string): Promise<ModuleInfo> {
  await ensureInit();

  const content = await readFile(filePath, 'utf-8');

  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  try {
    const [parsedImports, parsedExports] = parse(content);

    // Process imports
    for (const imp of parsedImports) {
      // imp.n is the module specifier (import source)
      // imp.d === -1 means static import, otherwise it's dynamic
      // imp.d === -2 means import.meta
      if (imp.n === undefined || imp.d === -2) {
        continue;
      }

      const isDynamic = imp.d > -1;

      // Extract specifiers from the import statement
      const statementText = content.slice(imp.ss, imp.se);
      const { specifiers, isNamespace } = extractImportSpecifiers(statementText);

      imports.push({
        source: imp.n,
        specifiers,
        isNamespace,
        isDynamic,
      });
    }

    // Process exports
    for (const exp of parsedExports) {
      // exp.n is the exported name
      // exp.ln is the local name (for re-exports)
      // exp.s, exp.e are positions
      const exportName = exp.n;

      // Check if it's a re-export by looking at the statement
      const statementStart = findExportStatementStart(content, exp.s);
      const statementEnd = findExportStatementEnd(content, exp.e);
      const statementText = content.slice(statementStart, statementEnd);

      const isDefault = exportName === 'default';
      const isNamespace = statementText.includes('export *');

      // Check for re-export source
      const sourceMatch = statementText.match(/from\s+['"]([^'"]+)['"]/);
      const source = sourceMatch ? sourceMatch[1] : undefined;

      exports.push({
        source,
        specifiers: [exportName],
        isNamespace,
        isDefault,
      });
    }

    // Also extract CommonJS require() calls
    const requireImports = extractRequires(content);
    imports.push(...requireImports);
  } catch (error) {
    // es-module-lexer can fail on some edge cases, fall back to regex
    logger.debug(`es-module-lexer failed for ${filePath}, falling back to regex:`, error);
    const fallbackImports = extractImportsWithRegex(content);
    imports.push(...fallbackImports);
  }

  logger.debug(`Parsed ${filePath}: ${imports.length} imports, ${exports.length} exports`);

  return {
    filePath,
    imports,
    exports,
  };
}

/**
 * Extract import specifiers from an import statement
 */
function extractImportSpecifiers(statement: string): { specifiers: string[]; isNamespace: boolean } {
  const specifiers: string[] = [];
  let isNamespace = false;

  // Check for namespace import: import * as name
  const namespaceMatch = statement.match(/import\s+\*\s+as\s+(\w+)/);
  if (namespaceMatch) {
    isNamespace = true;
    specifiers.push(namespaceMatch[1]);
    return { specifiers, isNamespace };
  }

  // Check for default import: import name from
  const defaultMatch = statement.match(/import\s+(\w+)\s+from/);
  if (defaultMatch && !statement.includes('{')) {
    specifiers.push(defaultMatch[1]);
  }

  // Check for default import with named imports: import name, { ... } from
  const defaultWithNamedMatch = statement.match(/import\s+(\w+)\s*,\s*\{/);
  if (defaultWithNamedMatch) {
    specifiers.push(defaultWithNamedMatch[1]);
  }

  // Check for named imports: import { a, b, c } from
  const namedMatch = statement.match(/\{([^}]+)\}/);
  if (namedMatch) {
    const names = namedMatch[1].split(',').map((n) => {
      // Handle "as" aliases: import { foo as bar }
      const parts = n.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    });
    specifiers.push(...names.filter((n) => n.length > 0));
  }

  // Dynamic import doesn't have specifiers at parse time
  if (statement.includes('import(')) {
    return { specifiers: [], isNamespace: false };
  }

  return { specifiers, isNamespace };
}

/**
 * Find the start of an export statement (scan backwards for 'export')
 */
function findExportStatementStart(content: string, pos: number): number {
  // Scan backwards to find 'export' keyword
  let i = pos;
  while (i > 0) {
    if (content.slice(i - 6, i) === 'export') {
      return i - 6;
    }
    i--;
    // Don't go too far back
    if (pos - i > 200) break;
  }
  return pos;
}

/**
 * Find the end of an export statement (scan forwards for semicolon or newline)
 */
function findExportStatementEnd(content: string, pos: number): number {
  let i = pos;
  while (i < content.length) {
    if (content[i] === ';' || content[i] === '\n') {
      return i + 1;
    }
    i++;
    // Don't go too far forward
    if (i - pos > 500) break;
  }
  return Math.min(pos + 100, content.length);
}

/**
 * Extract CommonJS require() calls using regex
 */
function extractRequires(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Match require('...') or require("...")
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;

  while ((match = requireRegex.exec(content)) !== null) {
    // Skip if it's inside a comment
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const lineContent = content.slice(lineStart, match.index);
    if (lineContent.includes('//') || lineContent.trim().startsWith('*')) {
      continue;
    }

    imports.push({
      source: match[1],
      specifiers: [],
      isNamespace: false,
      isDynamic: false,
    });
  }

  return imports;
}

/**
 * Fallback regex-based import extraction for files that es-module-lexer can't parse
 */
function extractImportsWithRegex(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Match ES imports
  const importRegex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\w+(?:\s*,\s*\{[^}]*\})?)|(?:\{[^}]*\}))\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      isNamespace: false,
      isDynamic: false,
    });
  }

  // Match dynamic imports
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      isNamespace: false,
      isDynamic: true,
    });
  }

  // Match require() calls
  imports.push(...extractRequires(content));

  return imports;
}
