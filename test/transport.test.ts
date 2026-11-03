import type { AxiosAdapter, AxiosResponse } from 'axios';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DigikalaAxiosTransport,
  DigikalaTransportConfigurationError,
  DigikalaTransportError,
} from '../src/node/index.js';
import {
  DigikalaRequestValidationError,
  DigikalaResponseValidationError,
} from '../src/validation/index.js';

const inputSchema = z.object({ id: z.number().positive() }).strict();
const outputSchema = z.object({ status: z.literal('ok') }).passthrough();

function response(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function request(transport: DigikalaAxiosTransport, overrides = {}) {
  return transport.request({
    method: 'POST',
    path: 'variants/1',
    input: { id: 1 },
    inputSchema,
    outputSchema,
    serialize: (input) => ({ data: input }),
    ...overrides,
  });
}

describe('Axios transport', () => {
  it('applies the fixed origin, 60 second timeout, and authenticated headers', async () => {
    const adapter = vi.fn<AxiosAdapter>((config) => {
      expect(config.baseURL).toBe('https://seller.digikala.com/open-api/v1');
      expect(config.timeout).toBe(60_000);
      expect(config.url).toBe('variants/1');
      expect(config.headers.get('Authorization')).toBe('Bearer secret-token');
      expect(config.headers.get('User-Agent')).toBe(
        'DigikalaTrustedBot/SelfToken/123',
      );
      return Promise.resolve(response({ status: 'ok' }));
    });
    const transport = new DigikalaAxiosTransport({
      adapter,
      credentials: () => ({
        accessToken: 'secret-token',
        sellerCode: '۱۲۳',
      }),
    });

    await expect(request(transport)).resolves.toEqual({ status: 'ok' });
    expect(adapter).toHaveBeenCalledOnce();
  });

  it('validates the request before resolving credentials or calling Axios', async () => {
    const adapter = vi.fn<AxiosAdapter>();
    const credentials = vi.fn(() => ({ accessToken: 'x', sellerCode: '1' }));
    const transport = new DigikalaAxiosTransport({ adapter, credentials });

    await expect(
      request(transport, { input: { id: -1 } }),
    ).rejects.toBeInstanceOf(DigikalaRequestValidationError);
    expect(credentials).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each(['https://evil.test/x', '//evil.test/x', '../tokens', 'x?token=1'])(
    'rejects unsafe path %s before resolving credentials',
    async (path) => {
      const credentials = vi.fn(() => ({ accessToken: 'x', sellerCode: '1' }));
      const transport = new DigikalaAxiosTransport({ credentials });
      await expect(request(transport, { path })).rejects.toBeInstanceOf(
        DigikalaTransportConfigurationError,
      );
      expect(credentials).not.toHaveBeenCalled();
    },
  );

  it('prevents serializers from overriding protected headers', async () => {
    const credentials = vi.fn(() => ({ accessToken: 'x', sellerCode: '1' }));
    const transport = new DigikalaAxiosTransport({ credentials });
    await expect(
      request(transport, {
        serialize: () => ({ headers: { authorization: 'attacker' } }),
      }),
    ).rejects.toBeInstanceOf(DigikalaTransportConfigurationError);
    expect(credentials).not.toHaveBeenCalled();
  });

  it('validates responses and forwards AbortSignal', async () => {
    const controller = new AbortController();
    const adapter: AxiosAdapter = (config) => {
      expect(config.signal).toBe(controller.signal);
      return Promise.resolve(response({ status: 'wrong' }));
    };
    const transport = new DigikalaAxiosTransport({
      adapter,
      credentials: () => ({ accessToken: 'x', sellerCode: '1' }),
    });
    await expect(
      request(transport, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(DigikalaResponseValidationError);
  });

  it('sanitizes Axios errors and exposes only safe hook metadata', async () => {
    const onError = vi.fn();
    const adapter: AxiosAdapter = (config) =>
      Promise.reject(
        new AxiosError(
          'secret-token raw-body',
          'ERR_BAD_RESPONSE',
          config,
          undefined,
          { ...response({ leaked: 'secret-token' }), status: 401 },
        ),
      );
    const transport = new DigikalaAxiosTransport({
      adapter,
      credentials: () => ({
        accessToken: 'secret-token',
        sellerCode: '1',
      }),
      hooks: { onError },
    });

    const error = await request(transport).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DigikalaTransportError);
    expect(JSON.stringify(error)).not.toContain('secret-token');
    expect(onError).toHaveBeenCalledWith(error, {
      method: 'POST',
      path: 'variants/1',
      timeoutMs: 60_000,
    });
  });

  it('exposes only bounded field-level validation issues', async () => {
    const adapter: AxiosAdapter = (config) =>
      Promise.reject(
        new AxiosError('bad request', 'ERR_BAD_REQUEST', config, undefined, {
          ...response({
            message: 'Validation failed',
            errors: { shipping_type: ['The selected value is invalid'] },
          }),
          status: 400,
        }),
      );
    const transport = new DigikalaAxiosTransport({
      adapter,
      credentials: () => ({ accessToken: 'x', sellerCode: 'validation-test' }),
    });
    const error = (await request(transport).catch(
      (caught: unknown) => caught,
    )) as DigikalaTransportError;
    expect(error.details.validationIssues).toEqual([
      'errors.shipping_type: The selected value is invalid',
    ]);
  });

  it('retries one rate-limited GET using the advertised delay', async () => {
    let attempts = 0;
    const adapter: AxiosAdapter = (config) => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(
          new AxiosError(
            'rate limited',
            'ERR_BAD_RESPONSE',
            config,
            undefined,
            {
              ...response({ status: 'error' }),
              status: 429,
              headers: new AxiosHeaders({ 'retry-after': '0' }),
            },
          ),
        );
      }
      return Promise.resolve(response({ status: 'ok' }));
    };
    const transport = new DigikalaAxiosTransport({
      adapter,
      credentials: () => ({ accessToken: 'x', sellerCode: 'rate-test' }),
      rateLimit: { readGapMs: 0, variantsReadGapMs: 0 },
    });

    await expect(request(transport, { method: 'GET' })).resolves.toEqual({
      status: 'ok',
    });
    expect(attempts).toBe(2);
  });
});
