import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DigikalaCacheManager,
  DigikalaCacheMissError,
  SqliteDigikalaCacheStore,
} from '../src/cache/index.js';
import type { DigikalaEmbeddingProvider } from '../src/cache/index.js';
import type { DigikalaAccountRecord } from '../src/auth/index.js';
import { DigikalaNodeClient } from '../src/node/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function sqliteStore() {
  const directory = await mkdtemp(join(tmpdir(), 'digikala-cache-'));
  directories.push(directory);
  return new SqliteDigikalaCacheStore({
    filename: join(directory, 'cache.sqlite'),
  });
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

function account(): DigikalaAccountRecord {
  return {
    version: 1,
    revision: 0,
    vendor: { id: 'vendor-1', name: 'Store', sellerCode: '123' },
    credentials: {
      publicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
      privateKey:
        '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      tokens: {
        accessToken: 'access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: {
          date: '2099-01-01T00:00:00.000Z',
          timezone_type: 3,
          timezone: 'UTC',
        },
        refreshTokenExpiresAt: {
          date: '2099-02-01T00:00:00.000Z',
          timezone_type: 3,
          timezone: 'UTC',
        },
        scopes: [],
      },
    },
    authentication: {
      status: 'authenticated',
      authenticatedAt: '2026-01-01T00:00:00.000Z',
      scopes: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const embedder: DigikalaEmbeddingProvider = {
  model: 'test-multilingual',
  embed(texts, kind) {
    return Promise.resolve(
      texts.map((text) => {
        const normalized = text.toLowerCase();
        const phone = normalized.includes('phone') ? 1 : 0;
        const shirt = normalized.includes('shirt') ? 1 : 0;
        return kind === 'query' ? [phone, shirt, 0.1] : [phone, shirt, 0.1];
      }),
    );
  },
};

describe('SQLite cache', () => {
  it('returns only fresh entries and supports forced refresh', async () => {
    const store = await sqliteStore();
    let now = new Date('2026-01-01T00:00:00.000Z');
    const cache = new DigikalaCacheManager({
      vendorId: 'vendor-1',
      store,
      ttlMs: 86_400_000,
      now: () => now,
    });
    const loader = vi
      .fn<() => Promise<{ value: number }>>()
      .mockResolvedValueOnce({ value: 1 })
      .mockResolvedValueOnce({ value: 2 })
      .mockResolvedValueOnce({ value: 3 });

    await expect(
      cache.readThrough('products', {}, undefined, loader),
    ).resolves.toEqual({ value: 1 });
    await expect(
      cache.readThrough('products', {}, undefined, loader),
    ).resolves.toEqual({ value: 1 });
    await expect(
      cache.readThrough('products', {}, { forceRefresh: true }, loader),
    ).resolves.toEqual({ value: 2 });
    now = new Date('2026-01-02T00:00:01.000Z');
    await expect(
      cache.readThrough('products', {}, undefined, loader),
    ).resolves.toEqual({ value: 3 });
    expect(loader).toHaveBeenCalledTimes(3);
    await cache.close();
  });

  it('coalesces concurrent misses and implements cache-only mode', async () => {
    const store = await sqliteStore();
    const cache = new DigikalaCacheManager({ vendorId: 'vendor-1', store });
    let resolveLoader!: (value: number) => void;
    const loader = vi.fn(
      () => new Promise<number>((resolve) => (resolveLoader = resolve)),
    );
    const requests = [
      cache.readThrough('variants', { page: 1 }, undefined, loader),
      cache.readThrough('variants', { page: 1 }, undefined, loader),
      cache.readThrough('variants', { page: 1 }, undefined, loader),
    ];
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    resolveLoader(42);
    await expect(Promise.all(requests)).resolves.toEqual([42, 42, 42]);
    await expect(
      cache.readThrough('products', {}, { cachePolicy: 'cache-only' }, loader),
    ).rejects.toBeInstanceOf(DigikalaCacheMissError);
    await cache.close();
  });

  it('atomically refreshes all pages and searches a separate vector table', async () => {
    const store = await sqliteStore();
    const cache = new DigikalaCacheManager({
      vendorId: 'vendor-1',
      store,
      embedder,
    });
    cache.registerLoader('products', (page) =>
      Promise.resolve({
        status: 'ok',
        data: {
          items:
            page === 1
              ? [{ product_id: 1, title: 'phone premium' }]
              : [{ product_id: 2, title: 'shirt cotton' }],
          pager: { page, item_per_page: 1, total_pages: 2 },
        },
      }),
    );
    cache.registerLoader('variants', () =>
      Promise.resolve({
        status: 'ok',
        data: {
          items: [{ id: 10, product_title: 'phone blue' }],
          pager: { page: 1, item_per_page: 1, total_pages: 1 },
        },
      }),
    );

    await expect(
      cache.refreshAll({ pageSize: 1, generateEmbeddings: true }),
    ).resolves.toMatchObject({ pages: 3, records: 3, embeddings: 3 });
    const matches = await cache.semanticSearch({ query: 'phone', limit: 2 });
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.id).sort()).toEqual(['1', '10']);
    expect(matches.every((match) => match.score > 0.9)).toBe(true);
    await cache.close();
  });

  it('does not replace the previous snapshot when a refresh fails', async () => {
    const store = await sqliteStore();
    const cache = new DigikalaCacheManager({
      vendorId: 'vendor-1',
      store,
      embedder,
    });
    cache.registerLoader('products', () =>
      Promise.resolve({
        status: 'ok',
        data: { items: [{ product_id: 1, title: 'phone' }] },
      }),
    );
    await cache.refreshAll({
      resources: ['products'],
      generateEmbeddings: true,
    });
    cache.registerLoader('products', () =>
      Promise.reject(new Error('offline')),
    );
    await expect(cache.refreshAll({ resources: ['products'] })).rejects.toThrow(
      'offline',
    );
    await expect(
      cache.semanticSearch({ query: 'phone' }),
    ).resolves.toMatchObject([{ id: '1' }]);
    await cache.close();
  });
});

describe('Node resource cache integration', () => {
  it('caches validated list calls and forceRefresh fetches current data', async () => {
    const store = await sqliteStore();
    let calls = 0;
    const adapter: AxiosAdapter = () => {
      calls += 1;
      return Promise.resolve(
        response({
          status: 'ok',
          data: { items: [{ product_id: calls, title: `product ${calls}` }] },
        }),
      );
    };
    const client = new DigikalaNodeClient({
      account: account(),
      cache: { store },
      transport: { adapter },
    });

    const first = await client.products.list();
    const cached = await client.products.list();
    const refreshed = await client.products.list({}, { forceRefresh: true });
    expect(first.data.items[0]?.product_id).toBe(1);
    expect(cached.data.items[0]?.product_id).toBe(1);
    expect(refreshed.data.items[0]?.product_id).toBe(2);
    expect(calls).toBe(2);
    await client.cache?.close();
  });
});
