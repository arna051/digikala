import { DigikalaAccount } from '../auth/index.js';
import type { DigikalaAccountRecord } from '../auth/index.js';
import { DigikalaAccountConflictError } from './errors.js';
import type { DigikalaAccountStore, SaveAccountOptions } from './types.js';

function cloneAccount(account: DigikalaAccountRecord): DigikalaAccountRecord {
  return structuredClone(account);
}

export class InMemoryDigikalaAccountStore implements DigikalaAccountStore {
  readonly #accounts = new Map<string, DigikalaAccountRecord>();

  constructor(initialAccounts: unknown[] = []) {
    for (const input of initialAccounts) {
      const account = DigikalaAccount.parse(input);
      this.#accounts.set(account.vendor.id, cloneAccount(account));
    }
  }

  load(vendorId: string): Promise<DigikalaAccountRecord | null> {
    const account = this.#accounts.get(vendorId);
    return Promise.resolve(account ? cloneAccount(account) : null);
  }

  save(
    accountInput: DigikalaAccountRecord,
    options: SaveAccountOptions = {},
  ): Promise<void> {
    const account = DigikalaAccount.parse(accountInput);
    const existing = this.#accounts.get(account.vendor.id);
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

    this.#accounts.set(account.vendor.id, cloneAccount(account));
    return Promise.resolve();
  }

  remove(vendorId: string): Promise<void> {
    this.#accounts.delete(vendorId);
    return Promise.resolve();
  }

  list(): Promise<DigikalaAccountRecord[]> {
    return Promise.resolve([...this.#accounts.values()].map(cloneAccount));
  }
}
