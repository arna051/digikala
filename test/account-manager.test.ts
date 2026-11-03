import { constants, publicEncrypt, randomBytes } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDigikalaAccountManager,
  SqliteDigikalaManagerStore,
} from '../src/node/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), 'digikala-manager-'));
  directories.push(directory);
  return join(directory, 'manager.sqlite');
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

function exchangeResponse(vendorId: string) {
  return {
    status: 'ok',
    data: {
      access_token: `access-secret-${vendorId}`,
      refresh_token: `refresh-secret-${vendorId}`,
      access_token_expires_at: {
        date: '2099-01-01T00:00:00.000Z',
        timezone_type: 3,
        timezone: 'UTC',
      },
      refresh_token_expires_at: {
        date: '2099-02-01T00:00:00.000Z',
        timezone_type: 3,
        timezone: 'UTC',
      },
      scopes: ['variant', 'order'],
    },
  };
}

async function registerAuthenticated(
  manager: Awaited<ReturnType<typeof createDigikalaAccountManager>>,
  vendorId: string,
) {
  const registration = await manager.accounts.register({
    vendor: {
      id: vendorId,
      name: `Store ${vendorId}`,
      sellerCode: `seller-${vendorId}`,
    },
  });
  await manager.accounts.markPublicKeyRegistered(vendorId);
  const authorizationCode = publicEncrypt(
    {
      key: registration.publicKey,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(`authorization-${vendorId}`),
  ).toString('base64');
  await manager.accounts.completeRegistration({
    vendorId,
    authorizationCode,
    exchange: (code) => {
      expect(code).toBe(`authorization-${vendorId}`);
      return Promise.resolve(exchangeResponse(vendorId));
    },
  });
}

function adapterFor(vendorId: string): AxiosAdapter {
  const suffix = vendorId === 'vendor-1' ? 1 : 2;
  return (config) => {
    const url = String(config.url);
    if (url.endsWith('products/seller')) {
      return Promise.resolve(
        response({
          status: 'ok',
          data: {
            items: [{ product_id: 100, title: `Shared phone ${suffix}` }],
          },
        }),
      );
    }
    if (url.endsWith('variants')) {
      return Promise.resolve(
        response({
          status: 'ok',
          data: {
            items: [
              {
                id: suffix * 1000 + 1,
                product_variant_id: 5001,
                product_id: 100,
                product_title: 'Shared phone',
                supplier_code: 'COMMON-SKU',
              },
            ],
          },
        }),
      );
    }
    if (url.includes('/seller-stock')) {
      return Promise.resolve(
        response({
          status: 'ok',
          data: {
            selling_stock: suffix * 10,
            marketplace_seller_stock: suffix * 8,
            warehouse_stock: suffix * 3,
            on_the_way_stock: suffix,
            reservation: suffix * 2,
            seller_reservation: suffix,
            digikala_reservation: suffix,
          },
        }),
      );
    }
    if (url.endsWith('orders')) {
      return Promise.resolve(
        response({
          status: 'ok',
          data: {
            items: [
              {
                order_id: 700,
                order_item_id: suffix,
                product_variant_id: suffix * 1000 + 1,
                product_title: 'Shared phone',
                quantity: suffix,
                order_created_at: `2026-01-0${suffix}T00:00:00.000Z`,
              },
            ],
          },
        }),
      );
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

describe('Digikala account manager', () => {
  it('encrypts account records and restores safe summaries', async () => {
    const filename = await databasePath();
    const encryptionKey = randomBytes(32).toString('base64');
    const manager = await createDigikalaAccountManager({
      sqlite: { filename },
      encryptionKey,
    });
    await registerAuthenticated(manager, 'vendor-1');
    expect(await manager.accounts.list()).toMatchObject([
      {
        id: 'vendor-1',
        authenticationStatus: 'authenticated',
      },
    ]);
    await manager.close();

    const databaseBytes = await readFile(filename);
    expect(databaseBytes.includes(Buffer.from('access-secret-vendor-1'))).toBe(
      false,
    );
    expect(databaseBytes.includes(Buffer.from('refresh-secret-vendor-1'))).toBe(
      false,
    );

    const restored = await createDigikalaAccountManager({
      sqlite: { filename },
      encryptionKey,
    });
    await expect(restored.accounts.get('vendor-1')).resolves.toMatchObject({
      name: 'Store vendor-1',
      authenticationStatus: 'authenticated',
    });
    await restored.close();

    const wrongKeyStore = new SqliteDigikalaManagerStore({
      filename,
      encryptionKey: randomBytes(32),
    });
    await expect(wrongKeyStore.load('vendor-1')).rejects.toThrow(
      'Unable to decrypt Digikala account vendor-1',
    );
    wrongKeyStore.close();
  }, 20_000);

  it('automatically correlates products and variants across accounts', async () => {
    const filename = await databasePath();
    let failSecondVendor = false;
    const manager = await createDigikalaAccountManager({
      sqlite: { filename },
      encryptionKey: randomBytes(32),
      clientOptions: (vendorId) => ({
        transport: {
          adapter: (config) =>
            failSecondVendor && vendorId === 'vendor-2'
              ? Promise.reject(new Error('private upstream failure'))
              : adapterFor(vendorId)(config),
        },
      }),
    });
    await registerAuthenticated(manager, 'vendor-1');
    await registerAuthenticated(manager, 'vendor-2');

    const progress = vi.fn();
    const result = await manager.syncAll({ onProgress: progress });

    expect(result.status).toBe('completed');
    expect(result.accounts).toHaveLength(2);
    expect(progress).toHaveBeenCalled();
    const products = await manager.tracking.listProducts();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ productId: 100 });
    expect(products[0]?.accounts.map((item) => item.vendorId).sort()).toEqual([
      'vendor-1',
      'vendor-2',
    ]);

    const inventory = await manager.tracking.getInventory(100);
    expect(inventory.accounts).toHaveLength(2);
    expect(inventory.accounts.map((item) => item.canonicalVariantId)).toEqual([
      5001, 5001,
    ]);
    expect(inventory.totals).toMatchObject({
      sellingStock: 30,
      marketplaceSellerStock: 24,
      warehouseStock: 9,
      reservation: 6,
      sellerReservation: 3,
      digikalaReservation: 3,
    });

    const orders = await manager.orders.list();
    expect(orders).toHaveLength(2);
    expect(orders.map((order) => order.vendorId).sort()).toEqual([
      'vendor-1',
      'vendor-2',
    ]);
    expect(orders.every((order) => order.trackedProductId === 100)).toBe(true);

    failSecondVendor = true;
    const partial = await manager.syncAll({ resources: ['catalog'] });
    expect(partial.status).toBe('partial');
    expect(partial.accounts).toMatchObject([
      { vendorId: 'vendor-1', status: 'completed' },
      {
        vendorId: 'vendor-2',
        status: 'failed',
        error: 'Digikala synchronization failed',
      },
    ]);
    expect(JSON.stringify(partial)).not.toContain('private upstream failure');
    expect((await manager.tracking.listProducts())[0]?.accounts).toHaveLength(
      2,
    );
    await manager.close();
  }, 30_000);
});
