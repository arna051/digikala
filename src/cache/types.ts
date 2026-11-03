export type DigikalaCachePolicy =
  'prefer-cache' | 'refresh' | 'cache-only' | 'network-only';

export interface DigikalaReadOptions {
  cachePolicy?: DigikalaCachePolicy;
  /** Friendly alias for `cachePolicy: 'refresh'`. */
  forceRefresh?: boolean;
}

export interface DigikalaCacheEntry {
  vendorId: string;
  resource: string;
  key: string;
  value: unknown;
  fetchedAt: string;
  expiresAt: string;
}

export interface DigikalaCachedEntity {
  vendorId: string;
  resource: 'products' | 'variants';
  id: string;
  data: unknown;
  fetchedAt: string;
}

export interface DigikalaSemanticDocument {
  vendorId: string;
  resource: 'products' | 'variants';
  id: string;
  sourceText: string;
  sourceHash: string;
  model: string;
  dimensions: number;
  embedding: readonly number[];
  generatedAt: string;
}

export interface DigikalaCacheSnapshot {
  resources: readonly ('products' | 'variants')[];
  entries: readonly DigikalaCacheEntry[];
  entities: readonly DigikalaCachedEntity[];
  embeddings: readonly DigikalaSemanticDocument[];
}

export interface DigikalaSemanticMatch {
  resource: 'products' | 'variants';
  id: string;
  score: number;
  data: unknown;
}

export interface DigikalaCacheStore {
  get(
    vendorId: string,
    resource: string,
    key: string,
  ): Promise<DigikalaCacheEntry | null>;
  set(entry: DigikalaCacheEntry): Promise<void>;
  invalidate(vendorId: string, resource?: string): Promise<number>;
  replaceSnapshot(
    vendorId: string,
    snapshot: DigikalaCacheSnapshot,
  ): Promise<void>;
  search(input: {
    vendorId: string;
    model: string;
    dimensions: number;
    embedding: readonly number[];
    resources?: readonly ('products' | 'variants')[];
    limit: number;
  }): Promise<DigikalaSemanticMatch[]>;
  close?(): void | Promise<void>;
}

export interface DigikalaEmbeddingProvider {
  readonly model: string;
  embed(
    texts: readonly string[],
    kind: 'document' | 'query',
  ): Promise<readonly (readonly number[])[]>;
}

export interface DigikalaRefreshProgress {
  resource: 'products' | 'variants';
  page: number;
  totalPages?: number;
  records: number;
}

export interface DigikalaRefreshSummary {
  startedAt: string;
  completedAt: string;
  pages: number;
  records: number;
  embeddings: number;
  resources: readonly ('products' | 'variants')[];
}
