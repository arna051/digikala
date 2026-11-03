import type { AxiosAdapter, AxiosResponse } from 'axios';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import type { DigikalaAccountRecord } from '../src/auth/index.js';
import {
  DigikalaTokenRefreshRejectedError,
  isAccessTokenExpiring,
  tokenExpiryMs,
} from '../src/auth/index.js';
import { DigikalaNodeClient } from '../src/node/index.js';
import { InMemoryDigikalaAccountStore } from '../src/persistence/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function account(
  overrides: {
    accessExpiry?: string;
    refreshExpiry?: string;
  } = {},
): DigikalaAccountRecord {
  return {
    version: 1,
    revision: 0,
    vendor: { id: 'vendor-1', name: 'Store', sellerCode: '۱۲۳' },
    credentials: {
      publicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
      privateKey:
        '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      tokens: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        accessTokenExpiresAt: {
          date: overrides.accessExpiry ?? '2026-01-01T00:01:00.000Z',
          timezone_type: 3,
          timezone: 'UTC',
        },
        refreshTokenExpiresAt: {
          date: overrides.refreshExpiry ?? '2026-07-01T00:00:00.000Z',
          timezone_type: 3,
          timezone: 'UTC',
        },
        scopes: ['variant'],
      },
    },
    authentication: {
      status: 'authenticated',
      authenticatedAt: '2025-12-01T00:00:00.000Z',
      scopes: ['variant'],
    },
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
  };
}

function refreshedResponse() {
  return {
    status: 'ok',
    data: {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      access_token_expires_at: {
        date: '2026-01-01T01:00:00.000Z',
        timezone_type: 3,
        timezone: 'UTC',
      },
      refresh_token_expires_at: {
        date: '2026-07-01T00:00:00.000Z',
        timezone_type: 3,
        timezone: 'UTC',
      },
      scopes: ['variant'],
    },
  };
}

function response(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function listResponse() {
  return response({ status: 'ok', data: { items: [] } });
}

describe('token expiry parsing', () => {
  it('parses Digikala Tehran timestamps deterministically', () => {
    expect(
      tokenExpiryMs({
        date: '2026-01-01 03:30:00.000000',
        timezone: 'Asia/Tehran',
      }),
    ).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(isAccessTokenExpiring(account().credentials.tokens!, now)).toBe(
      true,
    );
  });
});

describe('Node client token lifecycle', () => {
  it('single-flights proactive refresh and persists rotated tokens', async () => {
    const initial = account();
    const store = new InMemoryDigikalaAccountStore([initial]);
    const exchange = vi.fn(() => Promise.resolve(refreshedResponse()));
    const seenAuthorization: string[] = [];
    const adapter: AxiosAdapter = (config) => {
      seenAuthorization.push(String(config.headers.get('Authorization')));
      return Promise.resolve(listResponse());
    };
    const client = new DigikalaNodeClient({
      account: initial,
      accountStore: store,
      tokenRefresh: { exchange, now: () => now },
      transport: { adapter },
    });

    await Promise.all([
      client.variants.list(),
      client.variants.list(),
      client.variants.list(),
    ]);

    expect(exchange).toHaveBeenCalledOnce();
    expect(exchange).toHaveBeenCalledWith({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      sellerCode: '۱۲۳',
    });
    expect(seenAuthorization).toEqual([
      'Bearer new-access',
      'Bearer new-access',
      'Bearer new-access',
    ]);
    expect(client.account.revision).toBe(1);
    expect(client.account.credentials.tokens?.refreshToken).toBe('new-refresh');
    expect((await store.load('vendor-1'))?.revision).toBe(1);
  });

  it('refreshes and retries exactly once after a 401', async () => {
    const exchange = vi.fn(() => Promise.resolve(refreshedResponse()));
    const headers: string[] = [];
    const adapter: AxiosAdapter = (config) => {
      headers.push(String(config.headers.get('Authorization')));
      if (headers.length === 1) {
        return Promise.reject(
          new AxiosError('raw secret', 'ERR_BAD_REQUEST', config, undefined, {
            ...response({ secret: 'raw' }),
            status: 401,
          }),
        );
      }
      return Promise.resolve(listResponse());
    };
    const client = new DigikalaNodeClient({
      account: account({ accessExpiry: '2026-02-01T00:00:00.000Z' }),
      tokenRefresh: { exchange, now: () => now },
      transport: { adapter },
    });

    await expect(client.variants.list()).resolves.toMatchObject({
      status: 'ok',
    });
    expect(headers).toEqual(['Bearer old-access', 'Bearer new-access']);
    expect(exchange).toHaveBeenCalledOnce();
  });

  it('does not loop when the retried request also returns 401', async () => {
    const adapter = vi.fn<AxiosAdapter>((config) =>
      Promise.reject(
        new AxiosError('secret', 'ERR_BAD_REQUEST', config, undefined, {
          ...response({}),
          status: 401,
        }),
      ),
    );
    const client = new DigikalaNodeClient({
      account: account({ accessExpiry: '2026-02-01T00:00:00.000Z' }),
      tokenRefresh: {
        exchange: () => Promise.resolve(refreshedResponse()),
        now: () => now,
      },
      transport: { adapter },
    });

    await expect(client.variants.list()).rejects.toMatchObject({
      details: { status: 401 },
    });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('marks expired refresh tokens as requiring reauthorization', async () => {
    const exchange = vi.fn(() => Promise.resolve(refreshedResponse()));
    const adapter = vi.fn<AxiosAdapter>();
    const client = new DigikalaNodeClient({
      account: account({ refreshExpiry: '2025-12-31T23:59:59.000Z' }),
      tokenRefresh: { exchange, now: () => now },
      transport: { adapter },
    });

    await expect(client.variants.list()).rejects.toThrow();
    expect(client.account.authentication).toMatchObject({
      status: 'reauthorization_required',
      reason: 'refresh_token_expired',
    });
    expect(client.account.credentials.tokens).toBeNull();
    expect(exchange).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
  });

  it('distinguishes rejected refresh credentials from transient failures', async () => {
    const rejected = new DigikalaNodeClient({
      account: account(),
      tokenRefresh: {
        exchange: () =>
          Promise.reject(new DigikalaTokenRefreshRejectedError(401)),
        now: () => now,
      },
    });
    await rejected.refreshAuthentication();
    expect(rejected.account.authentication).toMatchObject({
      status: 'reauthorization_required',
      reason: 'invalid_credentials',
    });

    const transient = new DigikalaNodeClient({
      account: account(),
      tokenRefresh: {
        exchange: () => Promise.reject(new Error('temporary network failure')),
        now: () => now,
      },
    });
    await expect(transient.refreshAuthentication()).rejects.toThrow(
      'temporary network failure',
    );
    expect(transient.account.authentication.status).toBe('authenticated');
    expect(transient.account.revision).toBe(0);
  });
});
