export class DigikalaAccountNotFoundError extends Error {
  override readonly name = 'DigikalaAccountNotFoundError';

  constructor(readonly vendorId: string) {
    super(`Digikala account was not found for vendor: ${vendorId}`);
  }
}

export class DigikalaAccountConflictError extends Error {
  override readonly name = 'DigikalaAccountConflictError';

  constructor(
    readonly vendorId: string,
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null,
  ) {
    super(
      `Digikala account revision conflict for ${vendorId}: expected ${String(expectedRevision)}, received ${String(actualRevision)}`,
    );
  }
}

export class DigikalaClientNotConnectedError extends Error {
  override readonly name = 'DigikalaClientNotConnectedError';

  constructor() {
    super('The Digikala Node client is not connected to an account');
  }
}
