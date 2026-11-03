import type {
  DigikalaWebhookHandlerOptions,
  DigikalaWebhookRequest,
} from './index.js';
import { createDigikalaWebhookHandler } from './index.js';

export interface ExpressWebhookRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ExpressWebhookResponse {
  status(code: number): ExpressWebhookResponse;
  json(body: unknown): unknown;
}

export type ExpressWebhookMiddleware = (
  request: ExpressWebhookRequest,
  response: ExpressWebhookResponse,
) => void | Promise<void>;

export function createExpressWebhookHandler(
  options: DigikalaWebhookHandlerOptions,
): ExpressWebhookMiddleware {
  const receiver = createDigikalaWebhookHandler(options);
  return async (request, response) => {
    const normalized: DigikalaWebhookRequest = {
      method: request.method,
      headers: request.headers,
      body: request.body,
    };
    const result = await receiver.handle(normalized);
    response.status(result.status).json(result.body);
  };
}

export type { DigikalaWebhookHandlerOptions } from './index.js';
