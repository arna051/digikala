import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { DigikalaAccount } from '../auth/index.js';
import type { DigikalaAccountRecord, VendorSummary } from '../auth/index.js';
import {
  DigikalaAccountConflictError,
  DigikalaAccountNotFoundError,
} from '../persistence/errors.js';
import type {
  DigikalaAccountStore,
  SaveAccountOptions,
} from '../persistence/types.js';
import type {
  DigikalaInventoryAccountSnapshot,
  DigikalaTrackedInventory,
  DigikalaTrackedProduct,
  DigikalaUnifiedOrder,
} from './types.js';

interface AccountRow {
  vendor_id: string;
  revision: number;
  payload: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
}

interface JsonObject {
  [key: string]: unknown;
}

export class SqliteDigikalaManagerStore implements DigikalaAccountStore {
  readonly #database: Database.Database;
  readonly #key: Buffer;

  constructor(options: {
    filename: string;
    encryptionKey: string | Uint8Array;
  }) {
    const require = createRequire(import.meta.url);
    let DatabaseConstructor: typeof Database;
    try {
      DatabaseConstructor = require('better-sqlite3') as typeof Database;
    } catch (error) {
      throw new Error('The Digikala account manager requires better-sqlite3', {
        cause: error,
      });
    }
    this.#key = parseEncryptionKey(options.encryptionKey);
    if (options.filename !== ':memory:') {
      mkdirSync(dirname(resolve(options.filename)), {
        recursive: true,
        mode: 0o700,
      });
    }
    this.#database = new DatabaseConstructor(options.filename);
    if (options.filename !== ':memory:') chmodSync(options.filename, 0o600);
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('foreign_keys = ON');
    this.#database.pragma('secure_delete = ON');
    this.#migrate();
  }

  load(vendorId: string): Promise<DigikalaAccountRecord | null> {
    const row = this.#database
      .prepare(
        'SELECT vendor_id, revision, payload, nonce, auth_tag FROM manager_accounts WHERE vendor_id = ?',
      )
      .get(vendorId) as AccountRow | undefined;
    return Promise.resolve().then(() => (row ? this.#decrypt(row) : null));
  }

  list(): Promise<DigikalaAccountRecord[]> {
    const rows = this.#database
      .prepare(
        'SELECT vendor_id, revision, payload, nonce, auth_tag FROM manager_accounts ORDER BY vendor_name, vendor_id',
      )
      .all() as AccountRow[];
    return Promise.resolve().then(() => rows.map((row) => this.#decrypt(row)));
  }

  save(
    accountInput: DigikalaAccountRecord,
    options: SaveAccountOptions = {},
  ): Promise<void> {
    const account = DigikalaAccount.parse(accountInput);
    this.#database.transaction(() => {
      const existing = this.#database
        .prepare('SELECT revision FROM manager_accounts WHERE vendor_id = ?')
        .get(account.vendor.id) as { revision: number } | undefined;
      const actualRevision = existing?.revision ?? null;
      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== actualRevision
      ) {
        throw new DigikalaAccountConflictError(
          account.vendor.id,
          options.expectedRevision,
          actualRevision,
        );
      }
      if (
        typeof options.expectedRevision === 'number' &&
        account.revision !== options.expectedRevision + 1
      ) {
        throw new DigikalaAccountConflictError(
          account.vendor.id,
          options.expectedRevision + 1,
          account.revision,
        );
      }
      const encrypted = this.#encrypt(account);
      this.#database
        .prepare(
          `INSERT INTO manager_accounts
      (vendor_id, vendor_name, seller_code, authentication_status, revision, payload, nonce, auth_tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vendor_id) DO UPDATE SET
        vendor_name=excluded.vendor_name, seller_code=excluded.seller_code,
        authentication_status=excluded.authentication_status, revision=excluded.revision,
        payload=excluded.payload, nonce=excluded.nonce, auth_tag=excluded.auth_tag,
        updated_at=excluded.updated_at`,
        )
        .run(
          account.vendor.id,
          account.vendor.name,
          account.vendor.sellerCode,
          account.authentication.status,
          account.revision,
          encrypted.payload,
          encrypted.nonce,
          encrypted.authTag,
          account.createdAt,
          account.updatedAt,
        );
    })();
    return Promise.resolve();
  }

  remove(vendorId: string): Promise<void> {
    this.#database.transaction(() => {
      this.#database
        .prepare('DELETE FROM manager_orders WHERE vendor_id = ?')
        .run(vendorId);
      this.#database
        .prepare('DELETE FROM inventory_snapshots WHERE vendor_id = ?')
        .run(vendorId);
      this.#database
        .prepare('DELETE FROM tracked_variant_bindings WHERE vendor_id = ?')
        .run(vendorId);
      this.#database
        .prepare('DELETE FROM tracked_product_bindings WHERE vendor_id = ?')
        .run(vendorId);
      this.#database
        .prepare('DELETE FROM manager_accounts WHERE vendor_id = ?')
        .run(vendorId);
      this.#removeOrphans();
    })();
    return Promise.resolve();
  }

  replaceCatalog(
    vendorId: string,
    products: readonly JsonObject[],
    variants: readonly JsonObject[],
    syncedAt: string,
  ): void {
    this.#database.transaction(() => {
      this.#database
        .prepare('DELETE FROM inventory_snapshots WHERE vendor_id = ?')
        .run(vendorId);
      this.#database
        .prepare('DELETE FROM tracked_variant_bindings WHERE vendor_id = ?')
        .run(vendorId);
      this.#database
        .prepare('DELETE FROM tracked_product_bindings WHERE vendor_id = ?')
        .run(vendorId);
      const putProduct = this.#database
        .prepare(`INSERT INTO tracked_products (product_id, title, data_json, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET title=excluded.title, data_json=excluded.data_json, updated_at=excluded.updated_at`);
      const bindProduct = this.#database.prepare(
        'INSERT INTO tracked_product_bindings (product_id, vendor_id, data_json, synced_at) VALUES (?, ?, ?, ?)',
      );
      for (const product of products) {
        const productId = positiveInteger(product.product_id);
        if (!productId) continue;
        const title = optionalString(product.title);
        putProduct.run(productId, title, JSON.stringify(product), syncedAt);
        bindProduct.run(productId, vendorId, JSON.stringify(product), syncedAt);
      }
      const putVariant = this.#database
        .prepare(`INSERT INTO tracked_variants (canonical_variant_id, product_id, title, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(canonical_variant_id) DO UPDATE SET product_id=excluded.product_id, title=excluded.title, updated_at=excluded.updated_at`);
      const bindVariant = this.#database
        .prepare(`INSERT INTO tracked_variant_bindings
        (canonical_variant_id, vendor_id, local_variant_id, product_id, supplier_code, data_json, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const ensureProduct = this.#database.prepare(
        'INSERT OR IGNORE INTO tracked_products (product_id, title, data_json, updated_at) VALUES (?, ?, ?, ?)',
      );
      const ensureProductBinding = this.#database.prepare(
        'INSERT OR IGNORE INTO tracked_product_bindings (product_id, vendor_id, data_json, synced_at) VALUES (?, ?, ?, ?)',
      );
      for (const variant of variants) {
        const localId = positiveInteger(variant.id);
        const productId = positiveInteger(variant.product_id);
        const canonicalId =
          positiveInteger(variant.product_variant_id) ?? localId;
        if (!localId || !productId || !canonicalId) continue;
        const title =
          optionalString(variant.product_title) ??
          optionalString(variant.title);
        ensureProduct.run(
          productId,
          title,
          JSON.stringify({ product_id: productId, title }),
          syncedAt,
        );
        ensureProductBinding.run(
          productId,
          vendorId,
          JSON.stringify({ product_id: productId, title }),
          syncedAt,
        );
        putVariant.run(canonicalId, productId, title, syncedAt);
        bindVariant.run(
          canonicalId,
          vendorId,
          localId,
          productId,
          optionalString(variant.supplier_code),
          JSON.stringify(variant),
          syncedAt,
        );
      }
      this.#removeOrphans();
    })();
  }

  listTrackedProducts(): DigikalaTrackedProduct[] {
    const accounts = this.#vendorSummaries();
    const rows = this.#database
      .prepare(
        `SELECT p.product_id, p.title, p.updated_at, b.vendor_id, b.data_json
      FROM tracked_products p JOIN tracked_product_bindings b ON b.product_id=p.product_id
      ORDER BY p.product_id, b.vendor_id`,
      )
      .all() as Array<{
      product_id: number;
      title: string | null;
      updated_at: string;
      vendor_id: string;
      data_json: string;
    }>;
    const products = new Map<number, DigikalaTrackedProduct>();
    for (const row of rows) {
      const account = accounts.get(row.vendor_id);
      if (!account) continue;
      const data = JSON.parse(row.data_json) as JsonObject;
      const product = products.get(row.product_id) ?? {
        productId: row.product_id,
        ...(row.title ? { title: row.title } : {}),
        accounts: [],
        updatedAt: row.updated_at,
      };
      product.accounts.push({
        vendorId: row.vendor_id,
        vendorName: account.name,
        productId: row.product_id,
        ...(optionalString(data.title)
          ? { title: optionalString(data.title) }
          : {}),
      });
      products.set(row.product_id, product);
    }
    return [...products.values()];
  }

  listVariantBindings(productId?: number): Array<{
    vendorId: string;
    productId: number;
    variantId: number;
    canonicalVariantId: number;
    supplierCode?: string | null;
  }> {
    const rows = (
      productId
        ? this.#database
            .prepare(
              'SELECT vendor_id, product_id, local_variant_id, canonical_variant_id, supplier_code FROM tracked_variant_bindings WHERE product_id = ?',
            )
            .all(productId)
        : this.#database
            .prepare(
              'SELECT vendor_id, product_id, local_variant_id, canonical_variant_id, supplier_code FROM tracked_variant_bindings',
            )
            .all()
    ) as Array<{
      vendor_id: string;
      product_id: number;
      local_variant_id: number;
      canonical_variant_id: number;
      supplier_code: string | null;
    }>;
    return rows.map((row) => ({
      vendorId: row.vendor_id,
      productId: row.product_id,
      variantId: row.local_variant_id,
      canonicalVariantId: row.canonical_variant_id,
      supplierCode: row.supplier_code,
    }));
  }

  saveInventory(
    input: Omit<DigikalaInventoryAccountSnapshot, 'vendorName'> & {
      data: unknown;
    },
  ): void {
    this.#database
      .prepare(
        `INSERT INTO inventory_snapshots
      (vendor_id, product_id, local_variant_id, canonical_variant_id, supplier_code,
       selling_stock, marketplace_seller_stock, warehouse_stock, on_the_way_stock,
       reservation, seller_reservation, digikala_reservation, data_json, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vendor_id, local_variant_id) DO UPDATE SET
       product_id=excluded.product_id, canonical_variant_id=excluded.canonical_variant_id,
       supplier_code=excluded.supplier_code, selling_stock=excluded.selling_stock,
       marketplace_seller_stock=excluded.marketplace_seller_stock,
       warehouse_stock=excluded.warehouse_stock, on_the_way_stock=excluded.on_the_way_stock,
       reservation=excluded.reservation, seller_reservation=excluded.seller_reservation,
       digikala_reservation=excluded.digikala_reservation, data_json=excluded.data_json,
       synced_at=excluded.synced_at`,
      )
      .run(
        input.vendorId,
        input.productId,
        input.variantId,
        input.canonicalVariantId,
        input.supplierCode ?? null,
        input.sellingStock ?? null,
        input.marketplaceSellerStock ?? null,
        input.warehouseStock ?? null,
        input.onTheWayStock ?? null,
        input.reservation ?? null,
        input.sellerReservation ?? null,
        input.digikalaReservation ?? null,
        JSON.stringify(input.data),
        input.syncedAt,
      );
  }

  saveInventoryBatch(
    snapshots: readonly (Omit<
      DigikalaInventoryAccountSnapshot,
      'vendorName'
    > & { data: unknown })[],
  ): void {
    this.#database.transaction(() => {
      for (const snapshot of snapshots) this.saveInventory(snapshot);
    })();
  }

  getInventory(productId: number): DigikalaTrackedInventory {
    const product = this.listTrackedProducts().find(
      (item) => item.productId === productId,
    );
    if (!product)
      throw new Error(`Tracked Digikala product ${productId} was not found`);
    const accounts = this.#vendorSummaries();
    const rows = this.#database
      .prepare(
        `SELECT * FROM inventory_snapshots WHERE product_id = ? ORDER BY vendor_id, local_variant_id`,
      )
      .all(productId) as Array<Record<string, unknown>>;
    const snapshots: DigikalaInventoryAccountSnapshot[] = rows.flatMap(
      (row) => {
        const vendorId = String(row.vendor_id);
        const vendor = accounts.get(vendorId);
        if (!vendor) return [];
        return [
          {
            vendorId,
            vendorName: vendor.name,
            productId: Number(row.product_id),
            variantId: Number(row.local_variant_id),
            canonicalVariantId: Number(row.canonical_variant_id),
            ...(typeof row.supplier_code === 'string'
              ? { supplierCode: row.supplier_code }
              : {}),
            ...snapshotNumbers(row),
            syncedAt: String(row.synced_at),
          },
        ];
      },
    );
    const fields = [
      'sellingStock',
      'marketplaceSellerStock',
      'warehouseStock',
      'onTheWayStock',
      'reservation',
      'sellerReservation',
      'digikalaReservation',
    ] as const;
    const totals = Object.fromEntries(
      fields.map((field) => [
        field,
        snapshots.reduce((sum, item) => sum + (item[field] ?? 0), 0),
      ]),
    ) as DigikalaTrackedInventory['totals'];
    return { product, totals, accounts: snapshots };
  }

  replaceOrders(
    vendorId: string,
    orders: readonly JsonObject[],
    syncedAt: string,
  ): void {
    this.#database.transaction(() => {
      this.#database
        .prepare('DELETE FROM manager_orders WHERE vendor_id = ?')
        .run(vendorId);
      const insert = this.#database.prepare(`INSERT INTO manager_orders
        (vendor_id, order_id, order_item_key, order_item_id, product_variant_id,
         product_title, quantity, order_created_at, data_json, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const order of orders) {
        const orderId = positiveInteger(order.order_id);
        if (!orderId) continue;
        const orderItemId = positiveInteger(order.order_item_id);
        insert.run(
          vendorId,
          orderId,
          orderItemId ? String(orderItemId) : 'order',
          orderItemId ?? null,
          positiveInteger(order.product_variant_id) ?? null,
          optionalString(order.product_title),
          positiveInteger(order.quantity) ?? null,
          optionalString(order.order_created_at),
          JSON.stringify(order),
          syncedAt,
        );
      }
    })();
  }

  listOrders(
    input: { vendorIds?: readonly string[]; createdAfter?: Date } = {},
  ): DigikalaUnifiedOrder[] {
    const accounts = this.#vendorSummaries();
    const rows = this.#database
      .prepare(
        `SELECT o.*,
      (SELECT v.product_id FROM tracked_variant_bindings v
       WHERE v.vendor_id=o.vendor_id AND (v.local_variant_id=o.product_variant_id OR v.canonical_variant_id=o.product_variant_id) LIMIT 1) AS tracked_product_id
      FROM manager_orders o ORDER BY order_created_at DESC, order_id DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    const selected = input.vendorIds ? new Set(input.vendorIds) : undefined;
    return rows.flatMap((row) => {
      const vendorId = String(row.vendor_id);
      const vendor = accounts.get(vendorId);
      const createdAt =
        typeof row.order_created_at === 'string'
          ? row.order_created_at
          : undefined;
      if (
        !vendor ||
        (selected && !selected.has(vendorId)) ||
        (input.createdAfter &&
          (!createdAt || Date.parse(createdAt) < input.createdAfter.getTime()))
      )
        return [];
      return [
        {
          vendorId,
          vendorName: vendor.name,
          orderId: Number(row.order_id),
          ...(row.order_item_id === null
            ? {}
            : { orderItemId: Number(row.order_item_id) }),
          ...(row.product_variant_id === null
            ? {}
            : { productVariantId: Number(row.product_variant_id) }),
          ...(typeof row.product_title === 'string'
            ? { productTitle: row.product_title }
            : {}),
          ...(row.quantity === null ? {} : { quantity: Number(row.quantity) }),
          ...(createdAt ? { orderCreatedAt: createdAt } : {}),
          ...(row.tracked_product_id === null
            ? {}
            : { trackedProductId: Number(row.tracked_product_id) }),
          data: JSON.parse(String(row.data_json)) as JsonObject,
          syncedAt: String(row.synced_at),
        },
      ];
    });
  }

  close(): void {
    this.#database.close();
  }

  #encrypt(account: DigikalaAccountRecord) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
    cipher.setAAD(Buffer.from(account.vendor.id));
    const payload = Buffer.concat([
      cipher.update(JSON.stringify(account), 'utf8'),
      cipher.final(),
    ]);
    return { payload, nonce, authTag: cipher.getAuthTag() };
  }

  #decrypt(row: AccountRow): DigikalaAccountRecord {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#key, row.nonce);
      decipher.setAAD(Buffer.from(row.vendor_id));
      decipher.setAuthTag(row.auth_tag);
      const plaintext = Buffer.concat([
        decipher.update(row.payload),
        decipher.final(),
      ]).toString('utf8');
      return DigikalaAccount.parse(JSON.parse(plaintext) as unknown);
    } catch (error) {
      throw new Error(`Unable to decrypt Digikala account ${row.vendor_id}`, {
        cause: error,
      });
    }
  }

  #vendorSummaries(): Map<string, VendorSummary> {
    const rows = this.#database
      .prepare(
        'SELECT vendor_id, payload, nonce, auth_tag, revision FROM manager_accounts',
      )
      .all() as AccountRow[];
    return new Map(
      rows.map((row) => {
        const summary = DigikalaAccount.toVendorSummary(this.#decrypt(row));
        return [summary.id, summary];
      }),
    );
  }

  #removeOrphans(): void {
    this.#database
      .prepare(
        'DELETE FROM tracked_variants WHERE canonical_variant_id NOT IN (SELECT canonical_variant_id FROM tracked_variant_bindings)',
      )
      .run();
    this.#database
      .prepare(
        'DELETE FROM tracked_products WHERE product_id NOT IN (SELECT product_id FROM tracked_product_bindings)',
      )
      .run();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS manager_accounts (
        vendor_id TEXT PRIMARY KEY, vendor_name TEXT NOT NULL, seller_code TEXT NOT NULL,
        authentication_status TEXT NOT NULL, revision INTEGER NOT NULL,
        payload BLOB NOT NULL, nonce BLOB NOT NULL, auth_tag BLOB NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tracked_products (
        product_id INTEGER PRIMARY KEY, title TEXT, data_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tracked_product_bindings (
        product_id INTEGER NOT NULL, vendor_id TEXT NOT NULL, data_json TEXT NOT NULL, synced_at TEXT NOT NULL,
        PRIMARY KEY (product_id, vendor_id),
        FOREIGN KEY(product_id) REFERENCES tracked_products(product_id) ON DELETE CASCADE,
        FOREIGN KEY(vendor_id) REFERENCES manager_accounts(vendor_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tracked_variants (
        canonical_variant_id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, title TEXT, updated_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES tracked_products(product_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tracked_variant_bindings (
        canonical_variant_id INTEGER NOT NULL, vendor_id TEXT NOT NULL, local_variant_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL, supplier_code TEXT, data_json TEXT NOT NULL, synced_at TEXT NOT NULL,
        PRIMARY KEY (canonical_variant_id, vendor_id),
        UNIQUE (vendor_id, local_variant_id),
        FOREIGN KEY(canonical_variant_id) REFERENCES tracked_variants(canonical_variant_id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES tracked_products(product_id) ON DELETE CASCADE,
        FOREIGN KEY(vendor_id) REFERENCES manager_accounts(vendor_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS inventory_snapshots (
        vendor_id TEXT NOT NULL, product_id INTEGER NOT NULL, local_variant_id INTEGER NOT NULL,
        canonical_variant_id INTEGER NOT NULL, supplier_code TEXT,
        selling_stock INTEGER, marketplace_seller_stock INTEGER, warehouse_stock INTEGER,
        on_the_way_stock INTEGER, reservation INTEGER, seller_reservation INTEGER,
        digikala_reservation INTEGER, data_json TEXT NOT NULL, synced_at TEXT NOT NULL,
        PRIMARY KEY (vendor_id, local_variant_id),
        FOREIGN KEY(vendor_id) REFERENCES manager_accounts(vendor_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS manager_orders (
        vendor_id TEXT NOT NULL, order_id INTEGER NOT NULL, order_item_key TEXT NOT NULL,
        order_item_id INTEGER, product_variant_id INTEGER, product_title TEXT, quantity INTEGER,
        order_created_at TEXT, data_json TEXT NOT NULL, synced_at TEXT NOT NULL,
        PRIMARY KEY (vendor_id, order_id, order_item_key),
        FOREIGN KEY(vendor_id) REFERENCES manager_accounts(vendor_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS tracked_variant_product ON tracked_variant_bindings(product_id, vendor_id);
      CREATE INDEX IF NOT EXISTS inventory_product ON inventory_snapshots(product_id, vendor_id);
      CREATE INDEX IF NOT EXISTS orders_created ON manager_orders(order_created_at, vendor_id);
    `);
  }
}

function parseEncryptionKey(value: string | Uint8Array): Buffer {
  const key =
    typeof value === 'string'
      ? Buffer.from(value, 'base64')
      : Buffer.from(value);
  if (key.length !== 32)
    throw new TypeError(
      'Account-manager encryption key must contain exactly 32 bytes',
    );
  return key;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function snapshotNumbers(
  row: Record<string, unknown>,
): Partial<DigikalaInventoryAccountSnapshot> {
  const map = {
    selling_stock: 'sellingStock',
    marketplace_seller_stock: 'marketplaceSellerStock',
    warehouse_stock: 'warehouseStock',
    on_the_way_stock: 'onTheWayStock',
    reservation: 'reservation',
    seller_reservation: 'sellerReservation',
    digikala_reservation: 'digikalaReservation',
  } as const;
  return Object.fromEntries(
    Object.entries(map).flatMap(([column, field]) =>
      row[column] === null ? [] : [[field, Number(row[column])]],
    ),
  );
}

export function requireManagedAccount(
  account: DigikalaAccountRecord | null,
  vendorId: string,
): DigikalaAccountRecord {
  if (!account) throw new DigikalaAccountNotFoundError(vendorId);
  return account;
}
