import { DigikalaAccount, DigikalaAuth } from '../auth/index.js';
import type { DigikalaAccountRecord, VendorSummary } from '../auth/index.js';
import { SqliteDigikalaCacheStore } from '../cache/index.js';
import type { DigikalaCacheStore } from '../cache/index.js';
import { DigikalaNodeClient } from '../node/client.js';
import type { Product, Variant } from '../resources/index.js';
import {
  SqliteDigikalaManagerStore,
  requireManagedAccount,
} from './sqlite-store.js';
import type {
  DigikalaAccountManagerOptions,
  DigikalaAccountRegistration,
  DigikalaInventoryAccountSnapshot,
  DigikalaManagerAccountOptions,
  DigikalaManagerCompleteRegistrationInput,
  DigikalaManagerSyncAccountResult,
  DigikalaManagerSyncOptions,
  DigikalaManagerSyncResult,
  DigikalaTrackedInventory,
  DigikalaTrackedProduct,
  DigikalaUnifiedOrder,
} from './types.js';

type JsonObject = Record<string, unknown>;

export class DigikalaAccountManager {
  readonly #options: DigikalaAccountManagerOptions;
  readonly #store: SqliteDigikalaManagerStore;
  readonly #cacheStore: SqliteDigikalaCacheStore;
  readonly #cacheStoreView: DigikalaCacheStore;
  readonly #clients = new Map<string, DigikalaNodeClient>();
  readonly #now: () => Date;
  readonly #concurrency: number;
  #closed = false;

  readonly accounts: {
    register: (
      input: DigikalaManagerAccountOptions,
    ) => Promise<DigikalaAccountRegistration>;
    markPublicKeyRegistered: (
      vendorId: string,
      options?: { now?: Date },
    ) => Promise<VendorSummary>;
    completeRegistration: (
      input: DigikalaManagerCompleteRegistrationInput,
    ) => Promise<VendorSummary>;
    list: () => Promise<VendorSummary[]>;
    get: (vendorId: string) => Promise<VendorSummary>;
    client: (vendorId: string) => Promise<DigikalaNodeClient>;
    remove: (vendorId: string) => Promise<void>;
  };

  readonly tracking: {
    refreshCatalog: (options?: {
      vendorIds?: readonly string[];
      pageSize?: number;
      forceRefresh?: boolean;
      signal?: AbortSignal;
    }) => Promise<{ products: number; variants: number }>;
    listProducts: () => Promise<DigikalaTrackedProduct[]>;
    refreshInventory: (options?: {
      vendorIds?: readonly string[];
      productIds?: readonly number[];
      forceRefresh?: boolean;
      signal?: AbortSignal;
    }) => Promise<number>;
    getInventory: (productId: number) => Promise<DigikalaTrackedInventory>;
  };

  readonly orders: {
    refreshAll: (options?: {
      vendorIds?: readonly string[];
      pageSize?: number;
      forceRefresh?: boolean;
      signal?: AbortSignal;
    }) => Promise<number>;
    list: (input?: {
      vendorIds?: readonly string[];
      createdAfter?: Date;
    }) => Promise<DigikalaUnifiedOrder[]>;
    cancelItem: (input: {
      vendorId: string;
      orderItemId: number;
      cancellationReasonId: number;
      count?: number;
    }) => ReturnType<DigikalaNodeClient['orders']['cancel']>;
  };

  constructor(options: DigikalaAccountManagerOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
    this.#concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(this.#concurrency) || this.#concurrency <= 0) {
      throw new TypeError(
        'Account-manager concurrency must be a positive integer',
      );
    }
    this.#store = new SqliteDigikalaManagerStore({
      filename: options.sqlite.filename,
      encryptionKey: options.encryptionKey,
    });
    this.#cacheStore = new SqliteDigikalaCacheStore(options.sqlite);
    this.#cacheStoreView = {
      get: (...args) => this.#cacheStore.get(...args),
      set: (...args) => this.#cacheStore.set(...args),
      invalidate: (...args) => this.#cacheStore.invalidate(...args),
      replaceSnapshot: (...args) => this.#cacheStore.replaceSnapshot(...args),
      search: (...args) => this.#cacheStore.search(...args),
    };

    this.accounts = Object.freeze({
      register: (input) => this.#register(input),
      markPublicKeyRegistered: (vendorId, transitionOptions) =>
        this.#markPublicKeyRegistered(vendorId, transitionOptions),
      completeRegistration: (input) => this.#completeRegistration(input),
      list: () => this.#listAccounts(),
      get: (vendorId) => this.#getAccountSummary(vendorId),
      client: (vendorId) => this.#client(vendorId),
      remove: (vendorId) => this.#removeAccount(vendorId),
    });
    this.tracking = Object.freeze({
      refreshCatalog: (refreshOptions) => this.#refreshCatalog(refreshOptions),
      listProducts: () => Promise.resolve(this.#store.listTrackedProducts()),
      refreshInventory: (refreshOptions) =>
        this.#refreshInventory(refreshOptions),
      getInventory: (productId) =>
        Promise.resolve(this.#store.getInventory(productId)),
    });
    this.orders = Object.freeze({
      refreshAll: (refreshOptions) => this.#refreshOrders(refreshOptions),
      list: (input) => Promise.resolve(this.#store.listOrders(input)),
      cancelItem: (input) => this.#cancelOrderItem(input),
    });
  }

  async syncAll(
    options: DigikalaManagerSyncOptions = {},
  ): Promise<DigikalaManagerSyncResult> {
    this.#assertOpen();
    const startedAt = this.#now();
    const resources = [
      ...(options.resources ?? ['catalog', 'inventory', 'orders']),
    ];
    const vendorIds = options.vendorIds
      ? [...options.vendorIds]
      : await this.#authenticatedVendorIds();
    const results: DigikalaManagerSyncAccountResult[] = [];
    for (const vendorId of vendorIds) {
      const result: DigikalaManagerSyncAccountResult = {
        vendorId,
        status: 'completed',
        products: 0,
        variants: 0,
        inventory: 0,
        orders: 0,
      };
      try {
        for (const resource of resources) {
          options.signal?.throwIfAborted();
          await options.onProgress?.({ vendorId, phase: resource });
          if (resource === 'catalog') {
            const catalog = await this.#refreshCatalog({
              vendorIds: [vendorId],
              pageSize: options.pageSize,
              forceRefresh: true,
              signal: options.signal,
            });
            result.products = catalog.products;
            result.variants = catalog.variants;
          } else if (resource === 'inventory') {
            result.inventory = await this.#refreshInventory({
              vendorIds: [vendorId],
              forceRefresh: true,
              signal: options.signal,
            });
          } else if (resource === 'orders') {
            result.orders = await this.#refreshOrders({
              vendorIds: [vendorId],
              pageSize: options.pageSize,
              forceRefresh: true,
              signal: options.signal,
            });
          } else if (resource === 'embeddings') {
            const client = await this.#client(vendorId);
            await client.cache?.refreshAll({
              resources: ['products', 'variants'],
              pageSize: options.pageSize,
              generateEmbeddings: true,
              signal: options.signal,
              onProgress: async (progress) =>
                options.onProgress?.({
                  vendorId,
                  phase: 'embeddings',
                  ...progress,
                }),
            });
          }
        }
        await options.onProgress?.({ vendorId, phase: 'complete' });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const account = await this.#store.load(vendorId);
        result.status =
          account?.authentication.status === 'reauthorization_required'
            ? 'reauthorization_required'
            : 'failed';
        result.error = safeSyncError(error);
      }
      results.push(result);
    }
    const completed = results.filter(
      (result) => result.status === 'completed',
    ).length;
    return {
      status:
        completed === results.length
          ? 'completed'
          : completed === 0
            ? 'failed'
            : 'partial',
      startedAt: startedAt.toISOString(),
      completedAt: this.#now().toISOString(),
      accounts: results,
    };
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#clients.clear();
    this.#cacheStore.close();
    this.#store.close();
    return Promise.resolve();
  }

  async #register(
    input: DigikalaManagerAccountOptions,
  ): Promise<DigikalaAccountRegistration> {
    this.#assertOpen();
    const account = await DigikalaAuth.createAccount(
      { vendor: input.vendor },
      { now: input.now ?? this.#now() },
    );
    await this.#store.save(account, { expectedRevision: null });
    return {
      vendor: DigikalaAccount.toVendorSummary(account),
      publicKey: account.credentials.publicKey,
      status: 'pending_public_key',
      nextAction: 'register_public_key',
    };
  }

  async #markPublicKeyRegistered(
    vendorId: string,
    options?: { now?: Date },
  ): Promise<VendorSummary> {
    const next = await this.#updateAccount(vendorId, (account) =>
      DigikalaAuth.markPublicKeyRegistered(account, {
        now: options?.now ?? this.#now(),
      }),
    );
    return DigikalaAccount.toVendorSummary(next);
  }

  async #completeRegistration(
    input: DigikalaManagerCompleteRegistrationInput,
  ): Promise<VendorSummary> {
    const next = await this.#updateAccount(input.vendorId, (account) =>
      DigikalaAuth.completeAuthentication({
        account,
        authorizationCode: input.authorizationCode,
        exchange: input.exchange,
        now: input.now ?? this.#now(),
      }),
    );
    this.#clients.delete(input.vendorId);
    return DigikalaAccount.toVendorSummary(next);
  }

  async #listAccounts(): Promise<VendorSummary[]> {
    this.#assertOpen();
    return (await this.#store.list()).map(DigikalaAccount.toVendorSummary);
  }

  async #getAccountSummary(vendorId: string): Promise<VendorSummary> {
    return DigikalaAccount.toVendorSummary(
      requireManagedAccount(await this.#store.load(vendorId), vendorId),
    );
  }

  async #client(vendorId: string): Promise<DigikalaNodeClient> {
    this.#assertOpen();
    const existing = this.#clients.get(vendorId);
    if (existing) return existing;
    requireManagedAccount(await this.#store.load(vendorId), vendorId);
    const advanced = this.#options.clientOptions?.(vendorId) ?? {};
    const client = new DigikalaNodeClient({
      vendorId,
      accountStore: this.#store,
      ...advanced,
      cache: {
        store: this.#cacheStoreView,
        ttlMs: this.#options.cache?.ttlMs,
        semantic: this.#options.cache?.semantic,
        now: this.#now,
      },
    });
    await client.connect();
    this.#clients.set(vendorId, client);
    return client;
  }

  async #removeAccount(vendorId: string): Promise<void> {
    this.#assertOpen();
    this.#clients.delete(vendorId);
    await this.#cacheStore.invalidate(vendorId);
    await this.#store.remove(vendorId);
  }

  async #updateAccount(
    vendorId: string,
    updater: (
      account: DigikalaAccountRecord,
    ) => DigikalaAccountRecord | Promise<DigikalaAccountRecord>,
  ): Promise<DigikalaAccountRecord> {
    this.#assertOpen();
    const current = requireManagedAccount(
      await this.#store.load(vendorId),
      vendorId,
    );
    const next = DigikalaAccount.parse(await updater(current));
    await this.#store.save(next, { expectedRevision: current.revision });
    this.#clients.delete(vendorId);
    return next;
  }

  async #refreshCatalog(
    options: {
      vendorIds?: readonly string[];
      pageSize?: number;
      forceRefresh?: boolean;
      signal?: AbortSignal;
    } = {},
  ) {
    this.#assertOpen();
    const vendorIds = options.vendorIds
      ? [...options.vendorIds]
      : await this.#authenticatedVendorIds();
    let productCount = 0;
    let variantCount = 0;
    for (const vendorId of vendorIds) {
      const client = await this.#client(vendorId);
      const products = await fetchPages<Product>(
        (page, size) =>
          client.products.list(
            { page, size },
            { forceRefresh: options.forceRefresh ?? true },
          ),
        options.pageSize,
        options.signal,
      );
      const variants = await fetchPages<Variant>(
        (page, size) =>
          client.variants.list(
            { page, size },
            { forceRefresh: options.forceRefresh ?? true },
          ),
        options.pageSize,
        options.signal,
      );
      this.#store.replaceCatalog(
        vendorId,
        products,
        variants,
        this.#now().toISOString(),
      );
      productCount += products.length;
      variantCount += variants.length;
    }
    return { products: productCount, variants: variantCount };
  }

  async #refreshInventory(
    options: {
      vendorIds?: readonly string[];
      productIds?: readonly number[];
      forceRefresh?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<number> {
    this.#assertOpen();
    const vendors = new Set(
      options.vendorIds
        ? options.vendorIds
        : await this.#authenticatedVendorIds(),
    );
    const products = options.productIds
      ? new Set(options.productIds)
      : undefined;
    const bindings = this.#store
      .listVariantBindings()
      .filter(
        (binding) =>
          vendors.has(binding.vendorId) &&
          (!products || products.has(binding.productId)),
      );
    const snapshots: Array<
      Omit<DigikalaInventoryAccountSnapshot, 'vendorName'> & { data: unknown }
    > = [];
    await mapConcurrent(bindings, this.#concurrency, async (binding) => {
      options.signal?.throwIfAborted();
      const client = await this.#client(binding.vendorId);
      const response = await client.variants.getStock(binding.variantId, {
        forceRefresh: options.forceRefresh ?? true,
      });
      const data = response.data as JsonObject;
      snapshots.push({
        vendorId: binding.vendorId,
        productId: binding.productId,
        variantId: binding.variantId,
        canonicalVariantId: binding.canonicalVariantId,
        supplierCode: binding.supplierCode,
        ...inventoryFields(data),
        data,
        syncedAt: this.#now().toISOString(),
      });
    });
    this.#store.saveInventoryBatch(snapshots);
    return bindings.length;
  }

  async #refreshOrders(
    options: {
      vendorIds?: readonly string[];
      pageSize?: number;
      forceRefresh?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<number> {
    this.#assertOpen();
    const vendorIds = options.vendorIds
      ? [...options.vendorIds]
      : await this.#authenticatedVendorIds();
    let count = 0;
    for (const vendorId of vendorIds) {
      const client = await this.#client(vendorId);
      const orders = await fetchPages<JsonObject>(
        (page, size) => client.orders.list({ page, size }),
        options.pageSize,
        options.signal,
      );
      this.#store.replaceOrders(vendorId, orders, this.#now().toISOString());
      count += orders.length;
    }
    return count;
  }

  #cancelOrderItem(input: {
    vendorId: string;
    orderItemId: number;
    cancellationReasonId: number;
    count?: number;
  }) {
    return this.#client(input.vendorId).then((client) =>
      client.orders.cancel({
        orderItemId: input.orderItemId,
        cancellationReasonId: input.cancellationReasonId,
        count: input.count,
      }),
    );
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('The Digikala account manager is closed');
  }

  async #authenticatedVendorIds(): Promise<string[]> {
    return (await this.accounts.list())
      .filter((account) => account.authenticationStatus === 'authenticated')
      .map((account) => account.id);
  }
}

export async function createDigikalaAccountManager(
  options: DigikalaAccountManagerOptions,
): Promise<DigikalaAccountManager> {
  const manager = new DigikalaAccountManager(options);
  try {
    await manager.accounts.list();
    return manager;
  } catch (error) {
    await manager.close();
    throw error;
  }
}

async function fetchPages<T extends JsonObject>(
  loader: (
    page: number,
    size: number,
  ) => Promise<{ data: { items: T[]; pager?: { total_pages?: number } } }>,
  pageSize = 50,
  signal?: AbortSignal,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 50)
    throw new TypeError('Page size must be an integer between 1 and 50');
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    signal?.throwIfAborted();
    const response = await loader(page, pageSize);
    items.push(...response.data.items);
    const totalPages = response.data.pager?.total_pages;
    if (
      (totalPages !== undefined && page >= totalPages) ||
      (totalPages === undefined && response.data.items.length < pageSize)
    )
      break;
  }
  return items;
}

function numberField(data: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function inventoryFields(
  data: JsonObject,
): Partial<DigikalaInventoryAccountSnapshot> {
  return {
    sellingStock: numberField(data, 'selling_stock'),
    marketplaceSellerStock: numberField(data, 'marketplace_seller_stock'),
    warehouseStock: numberField(data, 'warehouse_stock', 'dk_warehouse_stock'),
    onTheWayStock: numberField(data, 'on_the_way_stock'),
    reservation: numberField(data, 'reservation'),
    sellerReservation: numberField(data, 'seller_reservation'),
    digikalaReservation: numberField(data, 'digikala_reservation'),
  };
}

function safeSyncError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'Synchronization was cancelled';
  if (
    error instanceof Error &&
    error.name === 'DigikalaClientNotConnectedError'
  )
    return 'The account is not authenticated';
  return 'Digikala synchronization failed';
}

async function mapConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) await operation(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}
