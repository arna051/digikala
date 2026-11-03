import axios, { AxiosError } from 'axios';
import {
  DEFAULT_TIMEOUT_MS,
  DIGIKALA_OPEN_API_BASE_URL,
} from '../config/defaults.js';
import { DigikalaAccount } from './account.js';
import { DigikalaAuthenticationTransitionError } from './errors.js';
import { DigikalaTokenRefreshRejectedError } from './errors.js';
import { DigikalaIdentity } from './identity.js';
import {
  DigikalaAccountSchema,
  TokenExchangeResponseSchema,
} from './schemas.js';
import type {
  AuthenticatedDigikalaAccount,
  DigikalaAccountRecord,
  TokenExchange,
  TokenRefreshExchange,
  VendorIdentity,
} from './types.js';
import { normalizeSellerCode } from '../transport/node-transport.js';

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

const defaultTokenExchange: TokenExchange = async (authorizationCode) => {
  const response = await axios.post(
    `${DIGIKALA_OPEN_API_BASE_URL}/auth/token`,
    { authorization_code: authorizationCode },
    { timeout: DEFAULT_TIMEOUT_MS, headers: { Accept: 'application/json' } },
  );
  return response.data as unknown;
};

const defaultTokenRefreshExchange: TokenRefreshExchange = async (input) => {
  try {
    const response = await axios.post(
      `${DIGIKALA_OPEN_API_BASE_URL}/auth/refresh-token`,
      {
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
      },
      {
        timeout: DEFAULT_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          Accept: 'application/json',
          'User-Agent': `DigikalaTrustedBot/SelfToken/${normalizeSellerCode(input.sellerCode)}`,
        },
      },
    );
    return response.data as unknown;
  } catch (error) {
    if (
      error instanceof AxiosError &&
      error.response &&
      [400, 401, 403].includes(error.response.status)
    ) {
      throw new DigikalaTokenRefreshRejectedError(error.response.status);
    }
    throw error;
  }
};

function tokensFromResponse(responseInput: unknown) {
  const response = TokenExchangeResponseSchema.parse(responseInput);
  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
    accessTokenExpiresAt: response.data.access_token_expires_at,
    refreshTokenExpiresAt: response.data.refresh_token_expires_at,
    scopes: response.data.scopes,
  };
}

export const DigikalaAuth = Object.freeze({
  async createAccount(
    input: { vendor: VendorIdentity },
    options: { now?: Date } = {},
  ): Promise<DigikalaAccountRecord> {
    const vendor = DigikalaAccount.validateVendor(input.vendor);
    const identity = await DigikalaIdentity.generate();
    const timestamp = nowIso(options.now);

    return DigikalaAccountSchema.parse({
      version: 1,
      revision: 0,
      vendor,
      credentials: { ...identity, tokens: null },
      authentication: { status: 'pending_public_key' },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },

  markPublicKeyRegistered(
    accountInput: unknown,
    options: { now?: Date } = {},
  ): DigikalaAccountRecord {
    const account = DigikalaAccount.parse(accountInput);
    if (account.authentication.status !== 'pending_public_key') {
      throw new DigikalaAuthenticationTransitionError(
        `Cannot register a public key from ${account.authentication.status} state`,
      );
    }

    const timestamp = nowIso(options.now);
    return DigikalaAccount.parse({
      ...account,
      revision: account.revision + 1,
      authentication: {
        status: 'waiting_for_authorization',
        publicKeyRegisteredAt: timestamp,
      },
      updatedAt: timestamp,
    });
  },

  async completeAuthentication(input: {
    account: unknown;
    authorizationCode: string;
    exchange?: TokenExchange;
    now?: Date;
  }): Promise<AuthenticatedDigikalaAccount> {
    const account = DigikalaAccount.parse(input.account);
    if (account.authentication.status !== 'waiting_for_authorization') {
      throw new DigikalaAuthenticationTransitionError(
        `Cannot complete authentication from ${account.authentication.status} state`,
      );
    }

    if (!DigikalaIdentity.validateKeyPair(account.credentials)) {
      throw new DigikalaAuthenticationTransitionError(
        'The stored Digikala public and private keys do not match',
      );
    }

    const authorizationCode = DigikalaIdentity.decryptAuthorizationCode(
      input.authorizationCode,
      account.credentials.privateKey,
    );
    const response = await (input.exchange ?? defaultTokenExchange)(
      authorizationCode,
    );
    const timestamp = nowIso(input.now);
    const tokens = tokensFromResponse(response);

    return DigikalaAccount.parse({
      ...account,
      revision: account.revision + 1,
      credentials: { ...account.credentials, tokens },
      authentication: {
        status: 'authenticated',
        authenticatedAt: timestamp,
        scopes: tokens.scopes,
      },
      updatedAt: timestamp,
    }) as AuthenticatedDigikalaAccount;
  },

  async refreshAuthentication(input: {
    account: unknown;
    exchange?: TokenRefreshExchange;
    now?: Date;
  }): Promise<AuthenticatedDigikalaAccount> {
    const account = DigikalaAccount.parse(input.account);
    if (!DigikalaAccount.isAuthenticated(account)) {
      throw new DigikalaAuthenticationTransitionError(
        `Cannot refresh authentication from ${account.authentication.status} state`,
      );
    }
    const currentTokens = account.credentials.tokens;
    const response = await (input.exchange ?? defaultTokenRefreshExchange)({
      accessToken: currentTokens.accessToken,
      refreshToken: currentTokens.refreshToken,
      sellerCode: account.vendor.sellerCode,
    });
    const tokens = tokensFromResponse(response);
    const timestamp = nowIso(input.now);
    return DigikalaAccount.parse({
      ...account,
      revision: account.revision + 1,
      credentials: { ...account.credentials, tokens },
      authentication: {
        ...account.authentication,
        scopes: tokens.scopes,
      },
      updatedAt: timestamp,
    }) as AuthenticatedDigikalaAccount;
  },

  revokeLocally(
    accountInput: unknown,
    options: { now?: Date } = {},
  ): DigikalaAccountRecord {
    const account = DigikalaAccount.parse(accountInput);
    const timestamp = nowIso(options.now);
    return DigikalaAccount.parse({
      ...account,
      revision: account.revision + 1,
      credentials: { ...account.credentials, tokens: null },
      authentication: { status: 'revoked', revokedAt: timestamp },
      updatedAt: timestamp,
    });
  },
});
