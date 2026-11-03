import { describe, expect, it, vi } from 'vitest';
import {
  DigikalaWebhookValidationError,
  InMemoryWebhookIdempotencyStore,
  createDigikalaWebhookHandler,
} from '../src/webhooks/index.js';
import type { DigikalaWebhookRequest } from '../src/webhooks/index.js';
import { createExpressWebhookHandler } from '../src/webhooks/express.js';

const event = {
  event_type: 'product_variant_status_change' as const,
  data: {
    product_variant_id: 12,
    product_variant_title: 'Variant',
    product_id: 3,
    active: true,
    deactivation_reason: null,
    seller_id: 4,
  },
};

describe('framework-neutral webhook receiver', () => {
  it('requires explicit authentication configuration', () => {
    expect(() =>
      createDigikalaWebhookHandler({
        onEvent: vi.fn(),
      } as never),
    ).toThrow(/verifier/);
  });

  it('authenticates before parsing and dispatches a typed event', async () => {
    const handler = vi.fn();
    const verifyRequest = vi.fn(
      (request: DigikalaWebhookRequest) =>
        request.headers?.authorization === 'secret',
    );
    const receiver = createDigikalaWebhookHandler({
      verifyRequest,
      handlers: { product_variant_status_change: handler },
    });

    await expect(
      receiver.handle({ method: 'POST', headers: {}, body: '{bad json' }),
    ).resolves.toEqual({
      status: 401,
      body: { ok: false, error: 'unauthorized' },
    });
    expect(handler).not.toHaveBeenCalled();

    await expect(
      receiver.handle({
        method: 'POST',
        headers: { authorization: 'secret' },
        body: JSON.stringify(event),
      }),
    ).resolves.toEqual({ status: 200, body: { ok: true } });
    expect(handler).toHaveBeenCalledWith(event, expect.any(Object));
  });

  it('reports validation safely without reflecting payload details', async () => {
    const onError = vi.fn((_error: unknown) => {
      void _error;
      throw new Error('monitor failed');
    });
    const receiver = createDigikalaWebhookHandler({
      allowUnauthenticated: true,
      onEvent: vi.fn(),
      onError,
    });
    const result = await receiver.handle({
      body: { secret: 'do-not-reflect' },
    });

    expect(result).toEqual({
      status: 400,
      body: { ok: false, error: 'invalid_payload' },
    });
    expect(JSON.stringify(result)).not.toContain('do-not-reflect');
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(
      DigikalaWebhookValidationError,
    );
  });

  it('deduplicates stable payloads and releases claims after failure', async () => {
    const store = new InMemoryWebhookIdempotencyStore();
    const handler = vi.fn().mockResolvedValue(undefined);
    const receiver = createDigikalaWebhookHandler({
      allowUnauthenticated: true,
      onEvent: handler,
      idempotencyStore: store,
    });

    expect((await receiver.handle({ body: event })).body).toEqual({ ok: true });
    expect(
      (
        await receiver.handle({
          body: { data: { ...event.data }, event_type: event.event_type },
        })
      ).body,
    ).toEqual({ ok: true, duplicate: true });
    expect(handler).toHaveBeenCalledOnce();

    const retryingHandler = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const retrying = createDigikalaWebhookHandler({
      allowUnauthenticated: true,
      onEvent: retryingHandler,
      idempotencyStore: new InMemoryWebhookIdempotencyStore(),
    });
    expect((await retrying.handle({ body: event })).status).toBe(500);
    expect((await retrying.handle({ body: event })).status).toBe(200);
    expect(retryingHandler).toHaveBeenCalledTimes(2);
  });

  it('rejects wrong methods, oversized raw bodies, and unhandled events', async () => {
    const receiver = createDigikalaWebhookHandler({
      allowUnauthenticated: true,
      handlers: { commission_change: vi.fn() },
      maxBodyBytes: 10,
    });
    expect((await receiver.handle({ method: 'GET', body: event })).status).toBe(
      405,
    );
    expect(
      (await receiver.handle({ body: JSON.stringify(event) })).status,
    ).toBe(413);

    const unhandled = createDigikalaWebhookHandler({
      allowUnauthenticated: true,
      handlers: { commission_change: vi.fn() },
    });
    expect((await unhandled.handle({ body: event })).status).toBe(500);
  });
});

describe('Express webhook adapter', () => {
  it('writes the core receiver result through an Express-compatible response', async () => {
    const status = vi.fn();
    const json = vi.fn();
    const response = { status, json };
    status.mockReturnValue(response);
    const middleware = createExpressWebhookHandler({
      allowUnauthenticated: true,
      onEvent: vi.fn(),
    });

    await middleware({ method: 'POST', body: event }, response);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ ok: true });
  });
});
