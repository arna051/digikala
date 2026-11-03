import type { z } from 'zod';

export interface DigikalaValidationIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

function safeIssues(error: z.ZodError): DigikalaValidationIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: [...issue.path].filter(
      (part): part is string | number =>
        typeof part === 'string' || typeof part === 'number',
    ),
    message: issue.message,
  }));
}

export class DigikalaValidationError extends Error {
  override readonly name: string = 'DigikalaValidationError';
  readonly issues: DigikalaValidationIssue[];

  constructor(message: string, error: z.ZodError) {
    super(message);
    this.issues = safeIssues(error);
  }
}

export class DigikalaRequestValidationError extends DigikalaValidationError {
  override readonly name = 'DigikalaRequestValidationError';

  constructor(error: z.ZodError) {
    super('Digikala request validation failed', error);
  }
}

export class DigikalaResponseValidationError extends DigikalaValidationError {
  override readonly name = 'DigikalaResponseValidationError';

  constructor(error: z.ZodError) {
    super('Digikala response validation failed', error);
  }
}

export class DigikalaWebhookValidationError extends DigikalaValidationError {
  override readonly name = 'DigikalaWebhookValidationError';

  constructor(error: z.ZodError) {
    super('Digikala webhook validation failed', error);
  }
}
