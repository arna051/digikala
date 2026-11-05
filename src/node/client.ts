import {
  DigikalaAccount,
  DigikalaAuth,
  DigikalaTokenRefreshRejectedError,
  isAccessTokenExpiring,
  isRefreshTokenExpired,
} from '../auth/index.js';
import type {
  DigikalaAccountRecord,
  TokenRefreshExchange,
  VendorSummary,
} from '../auth/index.js';
import { Digikala } from '../digikala.js';
import {
  DigikalaAccountNotFoundError,
  DigikalaClientNotConnectedError,
} from '../persistence/errors.js';
import type {
  DigikalaAccountChangeHandler,
  DigikalaAccountStore,
  DigikalaAccountUpdater,
} from '../persistence/types.js';
import type { DigikalaClientOptions } from '../types/index.js';
import { DigikalaAxiosTransport } from '../transport/node-transport.js';
import type { DigikalaAxiosTransportOptions } from '../transport/types.js';
import {
  DigikalaOrdersResource,
  DigikalaProductCreationResource,
  DigikalaProductsResource,
  DigikalaVariantCreationResource,
  DigikalaVariantsResource,
  DigikalaProfileResource,
  DigikalaShipmentsResource,
  DigikalaProductEditingResource,
  DigikalaServiceHubResource,
} from '../resources/index.js';
import {
  DigikalaCacheManager,
  SqliteDigikalaCacheStore,
  TransformersJsEmbeddingProvider,
} from '../cache/index.js';
import type {
  DigikalaCacheStore,
  DigikalaEmbeddingProvider,
} from '../cache/index.js';

type DirectAccountSource = { account: unknown; vendorId?: never };
type StoredAccountSource = {
  account?: never;
  vendorId: string;
  accountStore: DigikalaAccountStore;
};

export type DigikalaNodeClientOptions = DigikalaClientOptions &
  (DirectAccountSource | StoredAccountSource) & {
    accountStore?: DigikalaAccountStore;
    onAccountChange?: DigikalaAccountChangeHandler;
    transport?: Omit<
      DigikalaAxiosTransportOptions,
      'baseUrl' | 'credentials' | 'onUnauthorized' | 'timeoutMs'
    >;
    tokenRefresh?: {
      automatic?: boolean;
      skewMs?: number;
      now?: () => Date;
      exchange?: TokenRefreshExchange;
    };
    cache?: {
      store?: DigikalaCacheStore;
      sqlite?: { filename: string };
      ttlMs?: number;
      now?: () => Date;
      semantic?:
        | boolean
        | {
            provider?: DigikalaEmbeddingProvider;
            model?: string;
            pipelineOptions?: Record<string, unknown>;
          };
    };
  };

export class DigikalaNodeClient extends Digikala {
  readonly #accountStore?: DigikalaAccountStore;
  readonly #vendorId: string;
  readonly #onAccountChange?: DigikalaAccountChangeHandler;
  readonly #automaticTokenRefresh: boolean;
  readonly #tokenRefreshSkewMs: number;
  readonly #tokenRefreshNow: () => Date;
  readonly #tokenRefreshExchange?: TokenRefreshExchange;
  readonly transport: DigikalaAxiosTransport;
  readonly variants: DigikalaVariantsResource;
  readonly products: DigikalaProductsResource;
  readonly orders: DigikalaOrdersResource;
  readonly productCreation: DigikalaProductCreationResource;
  readonly variantCreation: DigikalaVariantCreationResource;
  readonly profile: DigikalaProfileResource;
  readonly shipments: DigikalaShipmentsResource;
  readonly productEditing: DigikalaProductEditingResource;
  readonly serviceHub: DigikalaServiceHubResource;
  readonly cache?: DigikalaCacheManager;
  #account?: DigikalaAccountRecord;
  #updateTail: Promise<void> = Promise.resolve();
  #refreshFlight?: Promise<boolean>;

  constructor(options: DigikalaNodeClientOptions) {
    super({ baseUrl: options.baseUrl, timeoutMs: options.timeoutMs });
    this.#accountStore = options.accountStore;
    this.#onAccountChange = options.onAccountChange;
    this.#automaticTokenRefresh = options.tokenRefresh?.automatic ?? true;
    this.#tokenRefreshSkewMs = options.tokenRefresh?.skewMs ?? 5 * 60 * 1_000;
    if (
      !Number.isFinite(this.#tokenRefreshSkewMs) ||
      this.#tokenRefreshSkewMs < 0
    ) {
      throw new TypeError('Token refresh skew must be a non-negative number');
    }
    this.#tokenRefreshNow = options.tokenRefresh?.now ?? (() => new Date());
    this.#tokenRefreshExchange = options.tokenRefresh?.exchange;

    if (options.account !== undefined) {
      this.#account = DigikalaAccount.parse(options.account);
      this.#vendorId = this.#account.vendor.id;
    } else if (options.vendorId) {
      this.#vendorId = options.vendorId;
    } else {
      throw new TypeError('Either account or vendorId is required');
    }

    this.transport = new DigikalaAxiosTransport({
      ...options.transport,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      credentials: async () => {
        if (this.#automaticTokenRefresh) {
          await this.#refreshAccessToken(false);
        }
        const account = this.account;
        if (
          account.authentication.status !== 'authenticated' ||
          !account.credentials.tokens
        ) {
          throw new DigikalaClientNotConnectedError();
        }
        return {
          accessToken: account.credentials.tokens.accessToken,
          sellerCode: account.vendor.sellerCode,
        };
      },
      onUnauthorized: this.#automaticTokenRefresh
        ? (rejected) => this.#handleUnauthorized(rejected.accessToken)
        : undefined,
    });
    if (options.cache) {
      if (options.cache.store && options.cache.sqlite) {
        throw new TypeError(
          'Configure either a cache store or SQLite, not both',
        );
      }
      const store =
        options.cache.store ??
        (options.cache.sqlite
          ? new SqliteDigikalaCacheStore(options.cache.sqlite)
          : undefined);
      if (!store)
        throw new TypeError('Cache requires a store or SQLite filename');
      const semantic = options.cache.semantic;
      const embedder =
        typeof semantic === 'object' && semantic.provider
          ? semantic.provider
          : semantic
            ? new TransformersJsEmbeddingProvider(
                typeof semantic === 'object'
                  ? {
                      model: semantic.model,
                      pipelineOptions: semantic.pipelineOptions,
                    }
                  : undefined,
              )
            : undefined;
      this.cache = new DigikalaCacheManager({
        vendorId: this.#vendorId,
        store,
        ttlMs: options.cache.ttlMs,
        now: options.cache.now,
        embedder,
      });
    }
    this.variants = new DigikalaVariantsResource(this.transport, this.cache);
    this.products = new DigikalaProductsResource(this.transport, this.cache);
    this.orders = new DigikalaOrdersResource(this.transport);
    this.productCreation = new DigikalaProductCreationResource(this.transport);
    this.variantCreation = new DigikalaVariantCreationResource(this.transport);
    this.profile = new DigikalaProfileResource(this.transport);
    this.shipments = new DigikalaShipmentsResource(this.transport);
    this.productEditing = new DigikalaProductEditingResource(this.transport);
    this.serviceHub = new DigikalaServiceHubResource(this.transport);
    this.cache?.registerLoader('products', (page, size) =>
      this.products.list({ page, size }, { cachePolicy: 'network-only' }),
    );
    this.cache?.registerLoader('variants', (page, size) =>
      this.variants.list({ page, size }, { cachePolicy: 'network-only' }),
    );
  }

  get connected(): boolean {
    return this.#account !== undefined;
  }

  get account(): Readonly<DigikalaAccountRecord> {
    if (!this.#account) throw new DigikalaClientNotConnectedError();
    return structuredClone(this.#account);
  }

  get vendor(): VendorSummary {
    return DigikalaAccount.toVendorSummary(this.account);
  }

  async connect(): Promise<this> {
    if (this.#account) return this;
    const stored = await this.#accountStore?.load(this.#vendorId);
    if (!stored) throw new DigikalaAccountNotFoundError(this.#vendorId);
    const account = DigikalaAccount.parse(stored);
    if (account.vendor.id !== this.#vendorId) {
      throw new DigikalaAccountNotFoundError(this.#vendorId);
    }
    this.#account = account;
    return this;
  }

  async refreshAuthentication(): Promise<Readonly<DigikalaAccountRecord>> {
    await this.#refreshAccessToken(true);
    return this.account;
  }

  async #handleUnauthorized(rejectedAccessToken: string): Promise<boolean> {
    const account = this.account;
    if (!DigikalaAccount.isAuthenticated(account)) return false;
    if (account.credentials.tokens.accessToken !== rejectedAccessToken) {
      return true;
    }
    return this.#refreshAccessToken(true);
  }

  #refreshAccessToken(force: boolean): Promise<boolean> {
    if (this.#refreshFlight) return this.#refreshFlight;

    const account = this.account;
    if (!DigikalaAccount.isAuthenticated(account))
      return Promise.resolve(false);
    const now = this.#tokenRefreshNow();
    if (
      !force &&
      !isAccessTokenExpiring(
        account.credentials.tokens,
        now,
        this.#tokenRefreshSkewMs,
      )
    ) {
      return Promise.resolve(true);
    }

    const flight = this.#performTokenRefresh(now).finally(() => {
      if (this.#refreshFlight === flight) this.#refreshFlight = undefined;
    });
    this.#refreshFlight = flight;
    return flight;
  }

  async #performTokenRefresh(now: Date): Promise<boolean> {
    const account = this.account;
    if (!DigikalaAccount.isAuthenticated(account)) return false;

    if (isRefreshTokenExpired(account.credentials.tokens, now)) {
      await this.updateAccount((current) =>
        DigikalaAccount.requireReauthorization(
          current,
          'refresh_token_expired',
          now,
        ),
      );
      return false;
    }

    try {
      await this.updateAccount((current) =>
        DigikalaAuth.refreshAuthentication({
          account: current,
          exchange: this.#tokenRefreshExchange,
          now,
        }),
      );
      return true;
    } catch (error) {
      if (!(error instanceof DigikalaTokenRefreshRejectedError)) throw error;
      await this.updateAccount((current) =>
        DigikalaAccount.requireReauthorization(
          current,
          'invalid_credentials',
          now,
        ),
      );
      return false;
    }
  }

  updateAccount(
    updater: DigikalaAccountUpdater,
  ): Promise<DigikalaAccountRecord> {
    const operation = this.#updateTail.then(async () => {
      const previous = this.account;
      const next = DigikalaAccount.parse(await updater(previous));

      if (next.vendor.id !== previous.vendor.id) {
        throw new TypeError('An account update cannot change the vendor id');
      }
      if (next.revision !== previous.revision + 1) {
        throw new TypeError(
          `An account update must increment revision ${previous.revision} to ${previous.revision + 1}`,
        );
      }

      await this.#accountStore?.save(next, {
        expectedRevision: previous.revision,
      });
      this.#account = next;
      await this.#onAccountChange?.({
        previous,
        current: structuredClone(next),
        summary: DigikalaAccount.toVendorSummary(next),
      });
    });

    this.#updateTail = operation.catch(() => undefined);
    return operation.then(() => this.account);
  }
}
