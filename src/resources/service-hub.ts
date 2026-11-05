import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';

const QueryValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export const ServiceHubRequestSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z
      .string()
      .trim()
      .min(1)
      .refine(
        (path) =>
          !path.includes('://') &&
          !path.startsWith('//') &&
          !path.split('/').includes('..'),
        'Path must be relative to the Digikala OpenAPI base URL',
      ),
    query: z.record(z.string(), QueryValueSchema.optional()).optional(),
    body: z.unknown().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type ServiceHubRequest = z.input<typeof ServiceHubRequestSchema>;

/**
 * Escape hatch for official Service Hub operations that do not have a named
 * SDK resource yet. Authentication, timeout, rate limiting and path safety
 * still go through the normal transport.
 */
export class DigikalaServiceHubResource {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

  request(input: ServiceHubRequest) {
    return this.transport.request({
      method: input.method,
      path: input.path,
      input,
      inputSchema: ServiceHubRequestSchema,
      outputSchema: z.unknown(),
      timeoutMs: input.timeoutMs,
      serialize: ({ query, body }) => ({ params: query, data: body }),
    });
  }
}
