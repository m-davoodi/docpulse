import { relative } from 'path';
import { logger } from '../utils/logger.js';
import type { ModuleInfo } from './parser.js';

export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, Set<string>>;
  reverseEdges: Map<string, Set<string>>;
}

export interface GraphNode {
  filePath: string;
  relativePath: string;
  dependencies: string[];
  dependents: string[];
}

/**
 * Build a dependency graph from parsed module information
 */
export function buildDependencyGraph(
  modules: ModuleInfo[],
  repoRoot: string
): DependencyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  // Create nodes
  for (const module of modules) {
    const relativePath = relative(repoRoot, module.filePath);
    
    nodes.set(module.filePath, {
      filePath: module.filePath,
      relativePath,
      dependencies: [],
      dependents: [],
    });

    edges.set(module.filePath, new Set());
    reverseEdges.set(module.filePath, new Set());
  }

  // Create edges
  for (const module of modules) {
    const fromNode = nodes.get(module.filePath);
    if (!fromNode) continue;

    // For each import, find the resolved module
    for (const imp of module.imports) {
      // Find the target module (this should be resolved file path)
      // For now, we'll use simple matching
      const targetPath = findModuleByImport(imp.source, modules);
      
      if (targetPath && nodes.has(targetPath)) {
        // Add edge from this module to target
        edges.get(module.filePath)?.add(targetPath);
        
        // Add reverse edge
        reverseEdges.get(targetPath)?.add(module.filePath);
        
        // Update node dependencies
        fromNode.dependencies.push(targetPath);
        
        const targetNode = nodes.get(targetPath);
        if (targetNode) {
          targetNode.dependents.push(module.filePath);
        }
      }
    }
  }

  logger.debug(`Built dependency graph: ${nodes.size} nodes, ${Array.from(edges.values()).reduce((sum, set) => sum + set.size, 0)} edges`);

  return {
    nodes,
    edges,
    reverseEdges,
  };
}

/**
 * Find a module by import source (simplified matching)
 */
function findModuleByImport(importSource: string, modules: ModuleInfo[]): string | null {
  // This is a simplified version - in practice, this should use the resolver
  for (const module of modules) {
    if (module.filePath.includes(importSource)) {
      return module.filePath;
    }
  }
  return null;
}

/**
 * Get all dependencies of a file (direct and transitive)
 */
export function getDependencies(
  filePath: string,
  graph: DependencyGraph,
  maxDepth = Infinity
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: filePath, depth: 0 }];

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;

    if (visited.has(path) || depth > maxDepth) {
      continue;
    }

    visited.add(path);

    const deps = graph.edges.get(path);
    if (deps) {
      for (const dep of deps) {
        queue.push({ path: dep, depth: depth + 1 });
      }
    }
  }

  // Remove the starting file
  visited.delete(filePath);

  return visited;
}

/**
 * Get all dependents of a file (files that depend on this file)
 */
export function getDependents(
  filePath: string,
  graph: DependencyGraph,
  maxDepth = Infinity
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: filePath, depth: 0 }];

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;

    if (visited.has(path) || depth > maxDepth) {
      continue;
    }

    visited.add(path);

    const deps = graph.reverseEdges.get(path);
    if (deps) {
      for (const dep of deps) {
        queue.push({ path: dep, depth: depth + 1 });
      }
    }
  }

  // Remove the starting file
  visited.delete(filePath);

  return visited;
}

/**
 * Compute the impacted closure: files that directly changed + their dependents
 */
export function computeImpactedClosure(
  changedFiles: string[],
  graph: DependencyGraph,
  maxDepth = 3
): Set<string> {
  const impacted = new Set<string>(changedFiles);

  for (const file of changedFiles) {
    const dependents = getDependents(file, graph, maxDepth);
    for (const dep of dependents) {
      impacted.add(dep);
    }
  }

  logger.debug(`Impacted closure: ${changedFiles.length} changed files -> ${impacted.size} total impacted`);

  return impacted;
}

/**
 * Export the graph to a simple format for debugging
 */
export function exportGraph(graph: DependencyGraph): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const [path, node] of graph.nodes) {
    result[node.relativePath] = node.dependencies.map(
      (dep) => graph.nodes.get(dep)?.relativePath || dep
    );
  }

  return result;
}
