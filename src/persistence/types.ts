import type { DigikalaAccountRecord, VendorSummary } from '../auth/index.js';

export interface SaveAccountOptions {
  /** `null` requires a new record; a number enables optimistic concurrency. */
  expectedRevision?: number | null;
}

export interface DigikalaAccountStore {
  load(vendorId: string): Promise<object | null>;
  save(
    account: DigikalaAccountRecord,
    options?: SaveAccountOptions,
  ): Promise<void>;
  remove(vendorId: string): Promise<void>;
  list?(): Promise<object[]>;
}

export type DigikalaAccountUpdater = (
  current: Readonly<DigikalaAccountRecord>,
) => DigikalaAccountRecord | Promise<DigikalaAccountRecord>;

export interface DigikalaAccountChange {
  previous: DigikalaAccountRecord;
  current: DigikalaAccountRecord;
  summary: VendorSummary;
}

export type DigikalaAccountChangeHandler = (
  change: DigikalaAccountChange,
) => void | Promise<void>;
