import { z } from 'zod';

export const ConfigSchema = z.object({
  llm: z
    .object({
      provider: z.string().default('openai'),
      model: z.string().default('gpt-4o'),
      baseUrl: z.string().default('https://api.openai.com/v1'),
      apiKey: z.string().optional(),
    })
    .default({}),
  docs: z
    .object({
      root: z.string().default('docs'),
      templates: z.record(z.string()).default({}),
    })
    .default({}),
  ignore: z.array(z.string()).default(['node_modules/**', 'dist/**', 'build/**', 'coverage/**']),
});

export type Config = z.infer<typeof ConfigSchema>;
