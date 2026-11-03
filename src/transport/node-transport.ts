import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from 'axios';
import type { z } from 'zod';
import {
  DEFAULT_TIMEOUT_MS,
  DIGIKALA_OPEN_API_BASE_URL,
} from '../config/defaults.js';
import {
  DigikalaRequestValidationError,
  DigikalaResponseValidationError,
} from '../validation/index.js';
import {
  DigikalaTransportConfigurationError,
  DigikalaTransportError,
} from './errors.js';
import type {
  DigikalaAxiosTransportOptions,
  DigikalaTransportRequest,
  DigikalaTransportRequestMetadata,
} from './types.js';

const FIXED_API_URL = new URL(DIGIKALA_OPEN_API_BASE_URL);
const sellerReadTails = new Map<string, Promise<void>>();
const sellerReadNextAllowedAt = new Map<string, number>();

async function acquireSellerRead(
  sellerCode: string,
  gapMs: number,
): Promise<() => void> {
  const previous = sellerReadTails.get(sellerCode) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  sellerReadTails.set(sellerCode, tail);
  await previous;
  const delay = Math.max(
    0,
    (sellerReadNextAllowedAt.get(sellerCode) ?? 0) - Date.now(),
  );
  if (delay > 0)
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  return () => {
    sellerReadNextAllowedAt.set(
      sellerCode,
      Math.max(
        sellerReadNextAllowedAt.get(sellerCode) ?? 0,
        Date.now() + gapMs,
      ),
    );
    release();
    void tail.finally(() => {
      if (sellerReadTails.get(sellerCode) === tail)
        sellerReadTails.delete(sellerCode);
    });
  };
}

function retryAfterMs(error: AxiosError): number {
  const headers = error.response?.headers as
    Record<string, unknown> | undefined;
  const raw = headers?.['retry-after'];
  if (raw !== undefined) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(120_000, seconds * 1_000);
    if (typeof raw === 'string') {
      const date = Date.parse(raw);
      if (Number.isFinite(date))
        return Math.min(120_000, Math.max(0, date - Date.now()));
    }
  }
  return 10_000;
}

function assertFixedBaseUrl(baseUrl: string): string {
  const candidate = new URL(baseUrl);
  const normalizedPath = candidate.pathname.replace(/\/+$/, '');
  if (
    candidate.protocol !== 'https:' ||
    candidate.origin !== FIXED_API_URL.origin ||
    normalizedPath !== FIXED_API_URL.pathname
  ) {
    throw new DigikalaTransportConfigurationError(
      `Authenticated transport base URL must be ${DIGIKALA_OPEN_API_BASE_URL}`,
    );
  }
  return `${candidate.origin}${normalizedPath}`;
}

export function normalizeDigikalaPath(path: string): string {
  const trimmed = path.trim();
  if (
    !trimmed ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed) ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('?') ||
    trimmed.includes('#')
  ) {
    throw new DigikalaTransportConfigurationError(
      'Digikala request path must be a non-empty relative path without a query or fragment',
    );
  }

  const normalized = trimmed.replace(/^\/+/, '');
  let segments: string[];
  try {
    segments = normalized
      .split('/')
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw new DigikalaTransportConfigurationError(
      'Digikala request path contains invalid URL encoding',
    );
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new DigikalaTransportConfigurationError(
      'Digikala request path cannot contain traversal segments',
    );
  }
  return normalized;
}

export function normalizeSellerCode(value: string): string {
  const normalized = value
    .trim()
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  if (!normalized || !/^[\x21-\x7e]+$/.test(normalized)) {
    throw new DigikalaTransportConfigurationError(
      'Digikala seller code contains unsupported characters',
    );
  }
  return normalized;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    return error.response
      ? `Digikala request failed with status ${error.response.status}`
      : `Digikala request failed${error.code ? ` (${error.code})` : ''}`;
  }
  return 'Digikala request failed';
}

function safeValidationIssues(value: unknown): string[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const output: string[] = [];
  const collect = (item: unknown, path = ''): void => {
    if (output.length >= 12) return;
    if (typeof item === 'string') {
      const clean = item
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .slice(0, 300);
      if (clean) output.push(path ? `${path}: ${clean}` : clean);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => collect(child, path));
      return;
    }
    if (item && typeof item === 'object') {
      Object.entries(item as Record<string, unknown>).forEach(([key, child]) =>
        collect(child, path ? `${path}.${key}` : key),
      );
    }
  };
  collect(record.errors, 'errors');
  if (output.length === 0) collect(record.message, 'message');
  return output.length ? [...new Set(output)] : undefined;
}

const PROTECTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'proxy-authorization',
  'user-agent',
]);

function assertSafeHeaders(headers: Record<string, unknown> | undefined): void {
  for (const name of Object.keys(headers ?? {})) {
    if (PROTECTED_HEADERS.has(name.toLowerCase())) {
      throw new DigikalaTransportConfigurationError(
        `The ${name} header is managed by the Digikala transport`,
      );
    }
  }
}

export class DigikalaAxiosTransport {
  readonly #axios: AxiosInstance;
  readonly #credentials: DigikalaAxiosTransportOptions['credentials'];
  readonly #hooks?: DigikalaAxiosTransportOptions['hooks'];
  readonly #onUnauthorized?: DigikalaAxiosTransportOptions['onUnauthorized'];
  readonly #timeoutMs: number;
  readonly #readGapMs: number;
  readonly #variantsReadGapMs: number;
  readonly #retry429: boolean;

  constructor(options: DigikalaAxiosTransportOptions) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new DigikalaTransportConfigurationError(
        'Digikala transport timeout must be a positive number',
      );
    }
    this.#credentials = options.credentials;
    this.#hooks = options.hooks;
    this.#onUnauthorized = options.onUnauthorized;
    const rateLimit =
      options.rateLimit === false ||
      (options.rateLimit === undefined && options.adapter !== undefined)
        ? false
        : (options.rateLimit ?? {});
    this.#readGapMs = rateLimit === false ? 0 : (rateLimit.readGapMs ?? 1_000);
    this.#variantsReadGapMs =
      rateLimit === false ? 0 : (rateLimit.variantsReadGapMs ?? 4_000);
    this.#retry429 = rateLimit === false ? false : (rateLimit.retry429 ?? true);
    if (
      !Number.isFinite(this.#readGapMs) ||
      this.#readGapMs < 0 ||
      !Number.isFinite(this.#variantsReadGapMs) ||
      this.#variantsReadGapMs < 0
    ) {
      throw new DigikalaTransportConfigurationError(
        'Digikala read gaps must be non-negative numbers',
      );
    }
    this.#axios = axios.create({
      baseURL: assertFixedBaseUrl(
        options.baseUrl ?? DIGIKALA_OPEN_API_BASE_URL,
      ),
      timeout: this.#timeoutMs,
      adapter: options.adapter,
      maxRedirects: 0,
    });
  }

  async request<
    TInputSchema extends z.ZodType,
    TOutputSchema extends z.ZodType,
  >(
    request: DigikalaTransportRequest<TInputSchema, TOutputSchema>,
  ): Promise<z.output<TOutputSchema>> {
    const path = normalizeDigikalaPath(request.path);
    const method = request.method.toUpperCase();
    const timeoutMs = request.timeoutMs ?? this.#timeoutMs;
    const metadata: DigikalaTransportRequestMetadata = {
      method,
      path,
      timeoutMs,
    };

    const parsedInput = request.inputSchema.safeParse(request.input);
    if (!parsedInput.success) {
      throw new DigikalaRequestValidationError(parsedInput.error);
    }

    const serialized = request.serialize(parsedInput.data);
    assertSafeHeaders(serialized.headers);
    const startedAt = Date.now();
    let retriedAfterUnauthorized = false;
    let retriedAfterRateLimit = false;

    while (true) {
      const resolved = await this.#credentials();
      const accessToken = resolved.accessToken.trim();
      if (!accessToken) {
        throw new DigikalaTransportConfigurationError(
          'Digikala access token is missing',
        );
      }
      const sellerCode = normalizeSellerCode(resolved.sellerCode);
      const releaseRead =
        method === 'GET' && (this.#readGapMs > 0 || this.#variantsReadGapMs > 0)
          ? await acquireSellerRead(
              sellerCode,
              path === 'variants' ? this.#variantsReadGapMs : this.#readGapMs,
            )
          : undefined;

      try {
        await this.#hooks?.beforeRequest?.(metadata);
        const config: AxiosRequestConfig = {
          method,
          url: path,
          params: serialized.params,
          data: serialized.data,
          responseType: request.responseType ?? 'json',
          signal: request.signal,
          timeout: timeoutMs,
          headers: {
            ...serialized.headers,
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': `DigikalaTrustedBot/SelfToken/${sellerCode}`,
          },
        };
        const response = await this.#axios.request<unknown>(config);
        const parsedOutput = request.outputSchema.safeParse(response.data);
        if (!parsedOutput.success) {
          throw new DigikalaResponseValidationError(parsedOutput.error);
        }
        await this.#hooks?.afterResponse?.({
          ...metadata,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return parsedOutput.data;
      } catch (error) {
        if (
          error instanceof AxiosError &&
          error.response?.status === 429 &&
          method === 'GET' &&
          this.#retry429 &&
          !retriedAfterRateLimit
        ) {
          retriedAfterRateLimit = true;
          const waitMs = retryAfterMs(error);
          sellerReadNextAllowedAt.set(
            sellerCode,
            Math.max(
              sellerReadNextAllowedAt.get(sellerCode) ?? 0,
              Date.now() + waitMs,
            ),
          );
          continue;
        }
        if (
          error instanceof AxiosError &&
          error.response?.status === 401 &&
          !retriedAfterUnauthorized &&
          this.#onUnauthorized
        ) {
          retriedAfterUnauthorized = true;
          try {
            if (await this.#onUnauthorized(resolved)) continue;
          } catch {
            // The final error remains sanitized below.
          }
        }

        const safeError =
          error instanceof DigikalaResponseValidationError ||
          error instanceof DigikalaTransportConfigurationError
            ? error
            : new DigikalaTransportError(safeErrorMessage(error), {
                method,
                path,
                ...(error instanceof AxiosError && error.response
                  ? { status: error.response.status }
                  : {}),
                ...(error instanceof AxiosError && error.code
                  ? { code: error.code }
                  : {}),
                ...(error instanceof AxiosError &&
                error.response?.headers['retry-after']
                  ? {
                      retryAfter: String(error.response.headers['retry-after']),
                    }
                  : {}),
                ...(error instanceof AxiosError && error.response
                  ? {
                      validationIssues: safeValidationIssues(
                        error.response.data,
                      ),
                    }
                  : {}),
              });
        await this.#hooks?.onError?.(safeError, metadata);
        throw safeError;
      } finally {
        releaseRead?.();
      }
    }
  }
}
