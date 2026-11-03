import type {
  TokenExchange,
  VendorIdentity,
  VendorSummary,
} from '../auth/index.js';
import type {
  DigikalaEmbeddingProvider,
  DigikalaRefreshProgress,
} from '../cache/index.js';
import type { DigikalaNodeClientOptions } from '../node/client.js';

export interface DigikalaAccountRegistration {
  vendor: VendorSummary;
  publicKey: string;
  status: 'pending_public_key';
  nextAction: 'register_public_key';
}

export interface DigikalaManagerAccountOptions {
  vendor: VendorIdentity;
  now?: Date;
}

export interface DigikalaManagerCompleteRegistrationInput {
  vendorId: string;
  authorizationCode: string;
  exchange?: TokenExchange;
  now?: Date;
}

export interface DigikalaTrackedProductBinding {
  vendorId: string;
  vendorName: string;
  productId: number;
  title?: string;
}

export interface DigikalaTrackedProduct {
  productId: number;
  title?: string;
  accounts: DigikalaTrackedProductBinding[];
  updatedAt: string;
}

export interface DigikalaInventoryAccountSnapshot {
  vendorId: string;
  vendorName: string;
  productId: number;
  variantId: number;
  canonicalVariantId: number;
  supplierCode?: string | null;
  sellingStock?: number;
  marketplaceSellerStock?: number;
  warehouseStock?: number;
  onTheWayStock?: number;
  reservation?: number;
  sellerReservation?: number;
  digikalaReservation?: number;
  syncedAt: string;
}

export interface DigikalaTrackedInventory {
  product: DigikalaTrackedProduct;
  totals: {
    sellingStock: number;
    marketplaceSellerStock: number;
    warehouseStock: number;
    onTheWayStock: number;
    reservation: number;
    sellerReservation: number;
    digikalaReservation: number;
  };
  accounts: DigikalaInventoryAccountSnapshot[];
}

export interface DigikalaUnifiedOrder {
  vendorId: string;
  vendorName: string;
  orderId: number;
  orderItemId?: number;
  productVariantId?: number;
  productTitle?: string;
  quantity?: number;
  orderCreatedAt?: string;
  trackedProductId?: number;
  data: Record<string, unknown>;
  syncedAt: string;
}

export type DigikalaManagerSyncResource =
  'catalog' | 'inventory' | 'orders' | 'embeddings';

export interface DigikalaManagerSyncAccountResult {
  vendorId: string;
  status: 'completed' | 'failed' | 'reauthorization_required';
  products: number;
  variants: number;
  inventory: number;
  orders: number;
  error?: string;
}

export interface DigikalaManagerSyncResult {
  status: 'completed' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  accounts: DigikalaManagerSyncAccountResult[];
}

export interface DigikalaAccountManagerOptions {
  sqlite: { filename: string };
  /** A base64-encoded 32-byte AES-256 key or a 32-byte Uint8Array. */
  encryptionKey: string | Uint8Array;
  cache?: {
    ttlMs?: number;
    semantic?:
      | boolean
      | {
          provider?: DigikalaEmbeddingProvider;
          model?: string;
          pipelineOptions?: Record<string, unknown>;
        };
  };
  /** Maximum concurrent per-variant inventory requests. Defaults to 4. */
  concurrency?: number;
  /** Advanced/testing hook for per-vendor transport and token options. */
  clientOptions?: (
    vendorId: string,
  ) => Pick<
    DigikalaNodeClientOptions,
    'baseUrl' | 'timeoutMs' | 'transport' | 'tokenRefresh'
  >;
  now?: () => Date;
}

export interface DigikalaManagerSyncOptions {
  vendorIds?: readonly string[];
  resources?: readonly DigikalaManagerSyncResource[];
  pageSize?: number;
  signal?: AbortSignal;
  onProgress?: (
    event:
      | ({
          vendorId: string;
          phase: DigikalaManagerSyncResource;
        } & Partial<DigikalaRefreshProgress>)
      | { vendorId: string; phase: 'complete' },
  ) => void | Promise<void>;
}
