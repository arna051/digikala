import { createHash } from 'node:crypto';
import {
  DigikalaWebhookValidationError,
  KnownWebhookEventSchema,
  WebhookSchemas,
} from '../validation/index.js';
import type { DigikalaWebhookEvent } from '../validation/index.js';

export interface DigikalaWebhookRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface DigikalaWebhookResponse {
  status: 200 | 400 | 401 | 405 | 413 | 500;
  body: { ok: boolean; duplicate?: true; error?: string };
}

export type DigikalaWebhookEventType = DigikalaWebhookEvent['event_type'];
export type DigikalaWebhookEventOf<TType extends DigikalaWebhookEventType> =
  Extract<DigikalaWebhookEvent, { event_type: TType }>;
export type DigikalaWebhookHandler<
  TEvent extends DigikalaWebhookEvent = DigikalaWebhookEvent,
> = (event: TEvent, request: DigikalaWebhookRequest) => void | Promise<void>;
export type DigikalaWebhookHandlers = {
  [TType in DigikalaWebhookEventType]?: DigikalaWebhookHandler<
    DigikalaWebhookEventOf<TType>
  >;
};

export interface DigikalaWebhookIdempotencyStore {
  claim(key: string, ttlMs: number): boolean | Promise<boolean>;
  release(key: string): void | Promise<void>;
}

interface CommonOptions {
  handlers?: DigikalaWebhookHandlers;
  onEvent?: DigikalaWebhookHandler;
  onError?: (
    error: unknown,
    event: DigikalaWebhookEvent | undefined,
  ) => void | Promise<void>;
  idempotencyStore?: DigikalaWebhookIdempotencyStore;
  idempotencyKey?: (
    event: DigikalaWebhookEvent,
    request: DigikalaWebhookRequest,
  ) => string | Promise<string>;
  idempotencyTtlMs?: number;
  maxBodyBytes?: number;
}

type AuthenticatedOptions = CommonOptions & {
  verifyRequest: (
    request: DigikalaWebhookRequest,
  ) => boolean | Promise<boolean>;
  allowUnauthenticated?: never;
};
type UnauthenticatedOptions = CommonOptions & {
  allowUnauthenticated: true;
  verifyRequest?: never;
};
export type DigikalaWebhookHandlerOptions =
  AuthenticatedOptions | UnauthenticatedOptions;

const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1_000;

export class InMemoryWebhookIdempotencyStore implements DigikalaWebhookIdempotencyStore {
  readonly #claims = new Map<string, number>();

  claim(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const expiresAt = this.#claims.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.#claims.set(key, now + ttlMs);
    return true;
  }

  release(key: string): void {
    this.#claims.delete(key);
  }
}

export class DigikalaWebhookReceiver {
  readonly #options: DigikalaWebhookHandlerOptions;
  readonly #maxBodyBytes: number;
  readonly #idempotencyTtlMs: number;

  constructor(options: DigikalaWebhookHandlerOptions) {
    if (!options.verifyRequest && options.allowUnauthenticated !== true) {
      throw new TypeError(
        'A webhook request verifier is required unless allowUnauthenticated is true',
      );
    }
    if (!options.onEvent && !hasHandlers(options.handlers)) {
      throw new TypeError('At least one Digikala webhook handler is required');
    }
    this.#maxBodyBytes = positiveNumber(
      options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      'maxBodyBytes',
    );
    this.#idempotencyTtlMs = positiveNumber(
      options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS,
      'idempotencyTtlMs',
    );
    this.#options = options;
  }

  async handle(
    request: DigikalaWebhookRequest,
  ): Promise<DigikalaWebhookResponse> {
    if ((request.method ?? 'POST').toUpperCase() !== 'POST') {
      return failure(405, 'method_not_allowed');
    }
    const verifier = this.#options.verifyRequest;
    if (verifier && !(await safelyVerify(verifier, request))) {
      return failure(401, 'unauthorized');
    }

    let body: unknown;
    try {
      body = parseBody(request.body, this.#maxBodyBytes);
    } catch (error) {
      return failure(
        error instanceof WebhookBodyTooLargeError ? 413 : 400,
        error instanceof WebhookBodyTooLargeError
          ? 'payload_too_large'
          : 'invalid_payload',
      );
    }
    const parsed = KnownWebhookEventSchema.safeParse(body);
    if (!parsed.success) {
      await notifyError(
        this.#options.onError,
        new DigikalaWebhookValidationError(parsed.error),
        undefined,
      );
      return failure(400, 'invalid_payload');
    }

    const event = parsed.data;
    let claimKey: string | undefined;
    try {
      if (this.#options.idempotencyStore) {
        claimKey = await (this.#options.idempotencyKey
          ? this.#options.idempotencyKey(event, request)
          : defaultIdempotencyKey(event));
        if (!claimKey.trim()) throw new TypeError('Idempotency key is empty');
        const claimed = await this.#options.idempotencyStore.claim(
          claimKey,
          this.#idempotencyTtlMs,
        );
        if (!claimed) {
          return { status: 200, body: { ok: true, duplicate: true } };
        }
      }

      await dispatch(this.#options, event, request);
      return { status: 200, body: { ok: true } };
    } catch (error) {
      if (claimKey && this.#options.idempotencyStore) {
        await safeRelease(this.#options.idempotencyStore, claimKey);
      }
      await notifyError(this.#options.onError, error, event);
      return failure(500, 'handler_failed');
    }
  }
}

export function createDigikalaWebhookHandler(
  options: DigikalaWebhookHandlerOptions,
): DigikalaWebhookReceiver {
  return new DigikalaWebhookReceiver(options);
}

function hasHandlers(handlers: DigikalaWebhookHandlers | undefined): boolean {
  return handlers !== undefined && Object.keys(handlers).length > 0;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number`);
  }
  return value;
}

async function safelyVerify(
  verifier: AuthenticatedOptions['verifyRequest'],
  request: DigikalaWebhookRequest,
): Promise<boolean> {
  try {
    return await verifier(request);
  } catch {
    return false;
  }
}

class WebhookBodyTooLargeError extends Error {}

function parseBody(body: unknown, maxBytes: number): unknown {
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > maxBytes)
      throw new WebhookBodyTooLargeError();
    return JSON.parse(body) as unknown;
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength > maxBytes) throw new WebhookBodyTooLargeError();
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  }
  return body;
}

function defaultIdempotencyKey(event: DigikalaWebhookEvent): string {
  return createHash('sha256').update(stableStringify(event)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function dispatch(
  options: DigikalaWebhookHandlerOptions,
  event: DigikalaWebhookEvent,
  request: DigikalaWebhookRequest,
): Promise<void> {
  const specific = options.handlers?.[event.event_type] as
    DigikalaWebhookHandler | undefined;
  if (specific) await specific(event, request);
  else if (options.onEvent) await options.onEvent(event, request);
  else throw new Error(`No handler configured for ${event.event_type}`);
}

async function safeRelease(
  store: DigikalaWebhookIdempotencyStore,
  key: string,
): Promise<void> {
  try {
    await store.release(key);
  } catch {
    // Preserve the original handler failure and its safe HTTP response.
  }
}

async function notifyError(
  callback: CommonOptions['onError'],
  error: unknown,
  event: DigikalaWebhookEvent | undefined,
): Promise<void> {
  try {
    await callback?.(error, event);
  } catch {
    // Observability callbacks must not change webhook acknowledgement behavior.
  }
}

function failure(
  status: DigikalaWebhookResponse['status'],
  error: string,
): DigikalaWebhookResponse {
  return { status, body: { ok: false, error } };
}

export {
  DigikalaWebhookValidationError,
  KnownWebhookEventSchema,
  WebhookSchemas,
};
export type { DigikalaWebhookEvent } from '../validation/index.js';
