import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import { readFile } from 'fs/promises';
import { extname } from 'path';
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

/**
 * Parse a JavaScript or TypeScript file and extract imports/exports
 */
export async function parseFile(filePath: string): Promise<ModuleInfo> {
  const ext = extname(filePath);
  const content = await readFile(filePath, 'utf-8');

  const parser = new Parser();

  // Set language based on file extension
  if (ext === '.ts' || ext === '.tsx') {
    parser.setLanguage(TypeScript.typescript);
  } else {
    parser.setLanguage(JavaScript);
  }

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;

  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  // Walk the tree and extract imports/exports
  walkTree(rootNode, (node) => {
    // Handle imports
    if (node.type === 'import_statement') {
      const importInfo = extractImport(node, content);
      if (importInfo) {
        imports.push(importInfo);
      }
    }

    // Handle dynamic imports
    if (node.type === 'call_expression') {
      const importInfo = extractDynamicImport(node, content);
      if (importInfo) {
        imports.push(importInfo);
      }
    }

    // Handle CommonJS require
    if (node.type === 'call_expression') {
      const requireInfo = extractRequire(node, content);
      if (requireInfo) {
        imports.push(requireInfo);
      }
    }

    // Handle exports
    if (
      node.type === 'export_statement' ||
      node.type === 'export_declaration' ||
      node.type === 'export_default_declaration'
    ) {
      const exportInfo = extractExport(node, content);
      if (exportInfo) {
        exports.push(exportInfo);
      }
    }
  });

  logger.debug(`Parsed ${filePath}: ${imports.length} imports, ${exports.length} exports`);

  return {
    filePath,
    imports,
    exports,
  };
}

/**
 * Walk a syntax tree and call a visitor function for each node
 */
function walkTree(node: Parser.SyntaxNode, visitor: (node: Parser.SyntaxNode) => void) {
  visitor(node);

  for (const child of node.children) {
    walkTree(child, visitor);
  }
}

/**
 * Extract import information from an import statement node
 */
function extractImport(node: Parser.SyntaxNode, source: string): ImportInfo | null {
  try {
    // Find the import source (string literal)
    const sourceNode = node.descendantsOfType('string').find((n) => n.parent?.type === 'import_statement');

    if (!sourceNode) {
      return null;
    }

    const importSource = source.slice(sourceNode.startIndex, sourceNode.endIndex).replace(/['"]/g, '');

    // Find import clause
    const importClause = node.childForFieldName('import');
    
    const specifiers: string[] = [];
    let isNamespace = false;

    if (importClause) {
      // Check for namespace import (import * as foo)
      if (importClause.text.includes('* as')) {
        isNamespace = true;
        const namespaceSpecifier = importClause.descendantsOfType('identifier').find(n => 
          n.parent?.type === 'namespace_import'
        );
        if (namespaceSpecifier) {
          specifiers.push(namespaceSpecifier.text);
        }
      } else {
        // Extract named imports or default import
        const identifiers = importClause.descendantsOfType('identifier');
        for (const id of identifiers) {
          specifiers.push(id.text);
        }
      }
    }

    return {
      source: importSource,
      specifiers,
      isNamespace,
      isDynamic: false,
    };
  } catch (error) {
    logger.debug('Failed to extract import:', error);
    return null;
  }
}

/**
 * Extract dynamic import information (import('...'))
 */
function extractDynamicImport(node: Parser.SyntaxNode, source: string): ImportInfo | null {
  try {
    // Check if this is a dynamic import
    const functionNode = node.childForFieldName('function');
    if (!functionNode || functionNode.type !== 'import') {
      return null;
    }

    // Get the argument (import source)
    const args = node.childForFieldName('arguments');
    if (!args) {
      return null;
    }

    const stringNode = args.descendantsOfType('string')[0];
    if (!stringNode) {
      return null;
    }

    const importSource = source.slice(stringNode.startIndex, stringNode.endIndex).replace(/['"]/g, '');

    return {
      source: importSource,
      specifiers: [],
      isNamespace: false,
      isDynamic: true,
    };
  } catch (error) {
    logger.debug('Failed to extract dynamic import:', error);
    return null;
  }
}

/**
 * Extract CommonJS require information
 */
function extractRequire(node: Parser.SyntaxNode, source: string): ImportInfo | null {
  try {
    const functionNode = node.childForFieldName('function');
    if (!functionNode || functionNode.type !== 'identifier' || functionNode.text !== 'require') {
      return null;
    }

    const args = node.childForFieldName('arguments');
    if (!args) {
      return null;
    }

    const stringNode = args.descendantsOfType('string')[0];
    if (!stringNode) {
      return null;
    }

    const requireSource = source.slice(stringNode.startIndex, stringNode.endIndex).replace(/['"]/g, '');

    return {
      source: requireSource,
      specifiers: [],
      isNamespace: false,
      isDynamic: false,
    };
  } catch (error) {
    logger.debug('Failed to extract require:', error);
    return null;
  }
}

/**
 * Extract export information
 */
function extractExport(node: Parser.SyntaxNode, source: string): ExportInfo | null {
  try {
    const specifiers: string[] = [];
    let exportSource: string | undefined;
    let isNamespace = false;
    let isDefault = false;

    // Check for default export
    if (node.type === 'export_default_declaration') {
      isDefault = true;
      return {
        specifiers: ['default'],
        isNamespace: false,
        isDefault: true,
      };
    }

    // Check for re-export (export { x } from './y')
    const sourceNode = node.descendantsOfType('string')[0];
    if (sourceNode) {
      exportSource = source.slice(sourceNode.startIndex, sourceNode.endIndex).replace(/['"]/g, '');
    }

    // Check for namespace export (export * from)
    if (node.text.includes('export *')) {
      isNamespace = true;
    }

    // Extract named exports
    const identifiers = node.descendantsOfType('identifier');
    for (const id of identifiers) {
      if (id.parent?.type === 'export_specifier' || id.parent?.type === 'export_clause') {
        specifiers.push(id.text);
      }
    }

    return {
      source: exportSource,
      specifiers,
      isNamespace,
      isDefault,
    };
  } catch (error) {
    logger.debug('Failed to extract export:', error);
    return null;
  }
}
