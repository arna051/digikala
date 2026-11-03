export class DigikalaAccountValidationError extends Error {
  override readonly name = 'DigikalaAccountValidationError';

  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

export class DigikalaAuthenticationTransitionError extends Error {
  override readonly name = 'DigikalaAuthenticationTransitionError';
}

export class DigikalaTokenRefreshRejectedError extends Error {
  override readonly name = 'DigikalaTokenRefreshRejectedError';

  constructor(readonly status?: number) {
    super('Digikala rejected the refresh token');
  }
}
