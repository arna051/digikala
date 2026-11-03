import { describe, expect, it } from 'vitest';
import { DigikalaAuth } from '../src/auth/index.js';
import { DigikalaNodeClient } from '../src/node/client.js';
import {
  DigikalaAccountConflictError,
  InMemoryDigikalaAccountStore,
} from '../src/persistence/index.js';

async function pendingAccount() {
  return DigikalaAuth.createAccount({
    vendor: { id: 'vendor-1', name: 'Store', sellerCode: 'seller-code' },
  });
}

describe('account persistence', () => {
  it('loads and validates an account by vendor id', async () => {
    const account = await pendingAccount();
    const store = new InMemoryDigikalaAccountStore([account]);
    const client = new DigikalaNodeClient({
      vendorId: account.vendor.id,
      accountStore: store,
    });

    expect(client.connected).toBe(false);
    await client.connect();
    expect(client.connected).toBe(true);
    expect(client.vendor.name).toBe('Store');
  });

  it('serializes updates and persists every revision', async () => {
    const account = await pendingAccount();
    const store = new InMemoryDigikalaAccountStore([account]);
    const revisions: number[] = [];
    const client = new DigikalaNodeClient({
      account,
      accountStore: store,
      onAccountChange: ({ current }) => {
        revisions.push(current.revision);
      },
    });

    const first = client.updateAccount((current) => ({
      ...current,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    }));
    const second = client.updateAccount((current) => ({
      ...current,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    }));

    await Promise.all([first, second]);
    expect(client.account.revision).toBe(2);
    expect((await store.load('vendor-1'))?.revision).toBe(2);
    expect(revisions).toEqual([1, 2]);
  });

  it('rejects stale writes using optimistic revisions', async () => {
    const account = await pendingAccount();
    const store = new InMemoryDigikalaAccountStore([account]);

    expect(() =>
      store.save({ ...account, revision: 2 }, { expectedRevision: 1 }),
    ).toThrow(DigikalaAccountConflictError);
  });

  it('does not expose mutable stored account references', async () => {
    const account = await pendingAccount();
    const store = new InMemoryDigikalaAccountStore([account]);
    const loaded = await store.load('vendor-1');
    if (!loaded) throw new Error('missing test account');

    loaded.vendor.name = 'Mutated';
    expect((await store.load('vendor-1'))?.vendor.name).toBe('Store');
  });
});
