export class DigikalaTransportConfigurationError extends Error {
  override readonly name = 'DigikalaTransportConfigurationError';
}

export class DigikalaTransportError extends Error {
  override readonly name = 'DigikalaTransportError';

  constructor(
    message: string,
    readonly details: {
      method: string;
      path: string;
      status?: number;
      code?: string;
      retryAfter?: string;
      validationIssues?: string[];
    },
  ) {
    super(message);
  }
}
