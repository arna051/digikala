import { createHash } from 'node:crypto';
import type {
  ProductListResponse,
  VariantListResponse,
} from '../resources/index.js';
import { stableCacheKey } from './stable-key.js';
import type {
  DigikalaCacheEntry,
  DigikalaCachePolicy,
  DigikalaCacheStore,
  DigikalaCachedEntity,
  DigikalaEmbeddingProvider,
  DigikalaReadOptions,
  DigikalaRefreshProgress,
  DigikalaRefreshSummary,
  DigikalaSemanticDocument,
  DigikalaSemanticMatch,
} from './types.js';

type ResourceName = 'products' | 'variants';
type ListResponse = ProductListResponse | VariantListResponse;
type PageLoader = (page: number, size: number) => Promise<ListResponse>;

export interface DigikalaCacheManagerOptions {
  vendorId: string;
  store: DigikalaCacheStore;
  ttlMs?: number;
  embedder?: DigikalaEmbeddingProvider;
  now?: () => Date;
}

export class DigikalaCacheMissError extends Error {
  override readonly name = 'DigikalaCacheMissError';
  constructor(readonly resource: string) {
    super(`No cached ${resource} response is available`);
  }
}

export class DigikalaCacheManager {
  readonly #vendorId: string;
  readonly #store: DigikalaCacheStore;
  readonly #ttlMs: number;
  readonly #embedder?: DigikalaEmbeddingProvider;
  readonly #now: () => Date;
  readonly #inFlight = new Map<string, Promise<unknown>>();
  readonly #loaders = new Map<ResourceName, PageLoader>();

  constructor(options: DigikalaCacheManagerOptions) {
    const ttlMs = options.ttlMs ?? 86_400_000;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new TypeError('Cache TTL must be a positive number');
    }
    this.#vendorId = options.vendorId;
    this.#store = options.store;
    this.#ttlMs = ttlMs;
    this.#embedder = options.embedder;
    this.#now = options.now ?? (() => new Date());
  }

  registerLoader(resource: ResourceName, loader: PageLoader): void {
    this.#loaders.set(resource, loader);
  }

  async readThrough<T>(
    resource: string,
    input: unknown,
    options: DigikalaReadOptions | undefined,
    loader: () => Promise<T>,
  ): Promise<T> {
    const policy: DigikalaCachePolicy = options?.forceRefresh
      ? 'refresh'
      : (options?.cachePolicy ?? 'prefer-cache');
    const key = stableCacheKey(input);
    const flightKey = `${resource}:${key}`;
    if (policy === 'prefer-cache' || policy === 'cache-only') {
      const entry = await this.#store.get(this.#vendorId, resource, key);
      if (entry && Date.parse(entry.expiresAt) > this.#now().getTime()) {
        return structuredClone(entry.value) as T;
      }
      if (policy === 'cache-only') throw new DigikalaCacheMissError(resource);
    }
    if (policy === 'network-only') return loader();
    const existing = this.#inFlight.get(flightKey);
    if (existing) return existing as Promise<T>;
    const flight = loader()
      .then(async (value) => {
        const fetchedAt = this.#now();
        await this.#store.set({
          vendorId: this.#vendorId,
          resource,
          key,
          value,
          fetchedAt: fetchedAt.toISOString(),
          expiresAt: new Date(fetchedAt.getTime() + this.#ttlMs).toISOString(),
        });
        return value;
      })
      .finally(() => this.#inFlight.delete(flightKey));
    this.#inFlight.set(flightKey, flight);
    return flight;
  }

  invalidate(resource?: string): Promise<number> {
    return this.#store.invalidate(this.#vendorId, resource);
  }

  async refreshAll(
    options: {
      resources?: readonly ResourceName[];
      pageSize?: number;
      generateEmbeddings?: boolean;
      signal?: AbortSignal;
      onProgress?: (progress: DigikalaRefreshProgress) => void | Promise<void>;
    } = {},
  ): Promise<DigikalaRefreshSummary> {
    const resources = [...(options.resources ?? ['products', 'variants'])];
    const pageSize = options.pageSize ?? 50;
    if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 50)
      throw new TypeError('Page size must be between 1 and 50');
    const startedAt = this.#now();
    const entries: DigikalaCacheEntry[] = [];
    const entities: DigikalaCachedEntity[] = [];
    let pages = 0;
    for (const resource of resources) {
      const loader = this.#loaders.get(resource);
      if (!loader)
        throw new Error(`No ${resource} refresh loader is registered`);
      let page = 1;
      while (true) {
        options.signal?.throwIfAborted();
        const response = await loader(page, pageSize);
        const fetchedAt = this.#now();
        const items = response.data.items;
        const totalPages = response.data.pager?.total_pages;
        entries.push({
          vendorId: this.#vendorId,
          resource,
          key: stableCacheKey({ page, size: pageSize, sort: 'id' }),
          value: response,
          fetchedAt: fetchedAt.toISOString(),
          expiresAt: new Date(fetchedAt.getTime() + this.#ttlMs).toISOString(),
        });
        for (const item of items) {
          const id = resource === 'products' ? item.product_id : item.id;
          entities.push({
            vendorId: this.#vendorId,
            resource,
            id: String(id),
            data: item,
            fetchedAt: fetchedAt.toISOString(),
          });
        }
        pages += 1;
        await options.onProgress?.({
          resource,
          page,
          totalPages,
          records: items.length,
        });
        if (
          (totalPages !== undefined && page >= totalPages) ||
          (totalPages === undefined && items.length < pageSize)
        )
          break;
        page += 1;
      }
    }
    const embeddings =
      options.generateEmbeddings && this.#embedder
        ? await this.#createEmbeddings(entities, options.signal)
        : [];
    await this.#store.replaceSnapshot(this.#vendorId, {
      resources,
      entries,
      entities,
      embeddings,
    });
    return {
      startedAt: startedAt.toISOString(),
      completedAt: this.#now().toISOString(),
      pages,
      records: entities.length,
      embeddings: embeddings.length,
      resources,
    };
  }

  async semanticSearch(input: {
    query: string;
    resources?: readonly ResourceName[];
    limit?: number;
  }): Promise<DigikalaSemanticMatch[]> {
    if (!this.#embedder)
      throw new Error('Semantic search requires an embedding provider');
    const query = input.query.trim();
    if (!query) throw new TypeError('Semantic query cannot be empty');
    const [embedding] = await this.#embedder.embed([query], 'query');
    if (!embedding) return [];
    assertEmbedding(embedding);
    return this.#store.search({
      vendorId: this.#vendorId,
      model: this.#embedder.model,
      dimensions: embedding.length,
      embedding,
      resources: input.resources,
      limit: input.limit ?? 20,
    });
  }

  async close(): Promise<void> {
    await this.#store.close?.();
  }

  async #createEmbeddings(
    entities: readonly DigikalaCachedEntity[],
    signal?: AbortSignal,
  ): Promise<DigikalaSemanticDocument[]> {
    if (!this.#embedder) return [];
    const documents: DigikalaSemanticDocument[] = [];
    const batchSize = 32;
    let dimensions: number | undefined;
    for (let offset = 0; offset < entities.length; offset += batchSize) {
      signal?.throwIfAborted();
      const batch = entities.slice(offset, offset + batchSize);
      const texts = batch.map((entity) => semanticText(entity.data));
      const vectors = await this.#embedder.embed(texts, 'document');
      if (vectors.length !== batch.length)
        throw new Error(
          'Embedding provider returned an unexpected vector count',
        );
      for (const [index, entity] of batch.entries()) {
        const sourceText = texts[index] ?? '';
        const embedding = vectors[index];
        if (!embedding) continue;
        assertEmbedding(embedding, dimensions);
        dimensions ??= embedding.length;
        documents.push({
          vendorId: this.#vendorId,
          resource: entity.resource,
          id: entity.id,
          sourceText,
          sourceHash: createHash('sha256').update(sourceText).digest('hex'),
          model: this.#embedder.model,
          dimensions: embedding.length,
          embedding,
          generatedAt: this.#now().toISOString(),
        });
      }
    }
    return documents;
  }
}

function assertEmbedding(
  embedding: readonly number[],
  dimensions?: number,
): void {
  if (
    embedding.length === 0 ||
    (dimensions !== undefined && embedding.length !== dimensions) ||
    embedding.some((value) => !Number.isFinite(value)) ||
    embedding.every((value) => value === 0)
  ) {
    throw new Error('Embedding provider returned an invalid vector');
  }
}

function semanticText(value: unknown): string {
  const parts: string[] = [];
  const visit = (item: unknown): void => {
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    )
      parts.push(String(item));
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object')
      Object.values(item).forEach(visit);
  };
  visit(value);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
