import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

export const VendorIdentitySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    sellerCode: nonEmptyString,
  })
  .strict();

export const TokenExpirySchema = z
  .object({
    date: nonEmptyString,
    timezone_type: z.number().int(),
    timezone: nonEmptyString,
  })
  .strict();

export const DigikalaTokensSchema = z
  .object({
    accessToken: nonEmptyString,
    refreshToken: nonEmptyString,
    accessTokenExpiresAt: TokenExpirySchema,
    refreshTokenExpiresAt: TokenExpirySchema,
    scopes: z.array(nonEmptyString),
  })
  .strict();

export const DigikalaCredentialsSchema = z
  .object({
    publicKey: z.string().includes('-----BEGIN PUBLIC KEY-----'),
    privateKey: z.string().includes('-----BEGIN PRIVATE KEY-----'),
    tokens: DigikalaTokensSchema.nullable(),
  })
  .strict();

export const AuthenticationStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending_public_key') }).strict(),
  z
    .object({
      status: z.literal('waiting_for_authorization'),
      publicKeyRegisteredAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      status: z.literal('authenticated'),
      authenticatedAt: z.string().datetime(),
      scopes: z.array(nonEmptyString),
    })
    .strict(),
  z
    .object({
      status: z.literal('reauthorization_required'),
      reason: z.enum([
        'access_revoked',
        'refresh_token_expired',
        'invalid_credentials',
      ]),
      detectedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      status: z.literal('revoked'),
      revokedAt: z.string().datetime(),
    })
    .strict(),
]);

export const DigikalaAccountSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    vendor: VendorIdentitySchema,
    credentials: DigikalaCredentialsSchema,
    authentication: AuthenticationStateSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((account, context) => {
    const authenticated = account.authentication.status === 'authenticated';
    if (authenticated !== (account.credentials.tokens !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['credentials', 'tokens'],
        message:
          'Tokens must exist only when the account is in authenticated state',
      });
    }

    if (
      account.authentication.status === 'authenticated' &&
      account.authentication.scopes.some(
        (scope: string) => !account.credentials.tokens?.scopes.includes(scope),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authentication', 'scopes'],
        message: 'Authentication scopes must match the token scopes',
      });
    }
  });

export const TokenExchangeResponseSchema = z
  .object({
    status: z.string().optional(),
    data: z
      .object({
        access_token: nonEmptyString,
        refresh_token: nonEmptyString,
        access_token_expires_at: TokenExpirySchema,
        refresh_token_expires_at: TokenExpirySchema,
        scopes: z.array(nonEmptyString).default([]),
      })
      .passthrough(),
  })
  .passthrough();

export const Schemas = Object.freeze({
  VendorIdentity: VendorIdentitySchema,
  Tokens: DigikalaTokensSchema,
  Credentials: DigikalaCredentialsSchema,
  AuthenticationState: AuthenticationStateSchema,
  Account: DigikalaAccountSchema,
});
