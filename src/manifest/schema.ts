import { z } from 'zod';

/**
 * Schema for the .manifest.json file
 */
export const ManifestSchema = z.object({
  schemaVersion: z.number().default(1),

  tool: z.object({
    name: z.string().default('docpulse'),
    version: z.string(),
  }),

  repo: z.object({
    root: z.string(),
    detected: z.object({
      packageManager: z.enum(['npm', 'pnpm', 'yarn', 'unknown']),
      workspace: z.enum(['single', 'monorepo', 'unknown']),
      languages: z.array(z.string()),
    }),
    ignore: z.object({
      globs: z.array(z.string()),
    }),
  }),

  docLayout: z.object({
    root: z.string().default('docs'),
    mustExist: z.array(z.string()).default(['docs/index.md', 'docs/architecture', 'docs/how-to']),
    conventionsSource: z.string().default('docs/index.md'),
  }),

  runs: z.object({
    lastSuccessful: z
      .object({
        timestamp: z.string(), // ISO 8601 date string
        gitCommit: z.string(),
        notes: z.string().optional(),
      })
      .nullable()
      .optional(),
    history: z
      .array(
        z.object({
          timestamp: z.string(),
          gitCommit: z.string(),
          success: z.boolean(),
          notes: z.string().optional(),
        })
      )
      .default([]),
  }),

  coverageMap: z.array(
    z.object({
      doc: z.string(), // Path to documentation file
      covers: z.array(z.string()), // Glob patterns for covered source files
      lastUpdated: z.string().optional(), // ISO 8601 date string
    })
  ).default([]),

  units: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['repo', 'package', 'app', 'lib']),
      path: z.string(),
      doc: z.string(),
      entrypoints: z.array(z.string()),
    })
  ).default([]),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestUnit = z.infer<typeof ManifestSchema>['units'][number];
export type ManifestCoverageEntry = z.infer<typeof ManifestSchema>['coverageMap'][number];
export type ManifestRun = z.infer<typeof ManifestSchema>['runs']['history'][number];
