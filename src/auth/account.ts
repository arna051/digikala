import { DigikalaAccountSchema, VendorIdentitySchema } from './schemas.js';
import { DigikalaAccountValidationError } from './errors.js';
import type {
  AuthenticatedDigikalaAccount,
  DigikalaAccountRecord,
  ReauthorizationReason,
  VendorIdentity,
  VendorSummary,
} from './types.js';

function parseAccount(account: unknown): DigikalaAccountRecord {
  const result = DigikalaAccountSchema.safeParse(account);
  if (!result.success) {
    throw new DigikalaAccountValidationError(
      'Invalid Digikala account',
      result.error.issues,
    );
  }
  return result.data;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function toVendorSummary(accountInput: unknown): VendorSummary {
  const account = parseAccount(accountInput);
  const tokens = account.credentials.tokens;
  return {
    id: account.vendor.id,
    name: account.vendor.name,
    sellerCode: account.vendor.sellerCode,
    authenticationStatus: account.authentication.status,
    scopes:
      account.authentication.status === 'authenticated'
        ? [...account.authentication.scopes]
        : [],
    ...(tokens
      ? { accessTokenExpiresAt: tokens.accessTokenExpiresAt.date }
      : {}),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export const DigikalaAccount = Object.freeze({
  parse: parseAccount,

  isAuthenticated(
    account: DigikalaAccountRecord,
  ): account is AuthenticatedDigikalaAccount {
    return (
      account.authentication.status === 'authenticated' &&
      account.credentials.tokens !== null
    );
  },

  toVendorSummary,

  redact(accountInput: unknown) {
    const account = parseAccount(accountInput);
    return {
      ...toVendorSummary(account),
      version: account.version,
      revision: account.revision,
      credentials: {
        publicKeyConfigured: Boolean(account.credentials.publicKey),
        privateKeyConfigured: Boolean(account.credentials.privateKey),
        tokensConfigured: account.credentials.tokens !== null,
      },
    };
  },

  validateVendor(vendor: unknown): VendorIdentity {
    return VendorIdentitySchema.parse(vendor);
  },

  requireReauthorization(
    accountInput: unknown,
    reason: ReauthorizationReason,
    now?: Date,
  ): DigikalaAccountRecord {
    const account = parseAccount(accountInput);
    const timestamp = nowIso(now);
    return parseAccount({
      ...account,
      revision: account.revision + 1,
      credentials: { ...account.credentials, tokens: null },
      authentication: {
        status: 'reauthorization_required',
        reason,
        detectedAt: timestamp,
      },
      updatedAt: timestamp,
    });
  },
});
