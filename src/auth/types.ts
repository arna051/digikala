import type { z } from 'zod';
import type {
  AuthenticationStateSchema,
  DigikalaAccountSchema,
  DigikalaCredentialsSchema,
  DigikalaTokensSchema,
  VendorIdentitySchema,
} from './schemas.js';

export type VendorIdentity = z.infer<typeof VendorIdentitySchema>;
export type DigikalaTokens = z.infer<typeof DigikalaTokensSchema>;
export type DigikalaCredentials = z.infer<typeof DigikalaCredentialsSchema>;
export type AuthenticationState = z.infer<typeof AuthenticationStateSchema>;
export type DigikalaAccountRecord = z.infer<typeof DigikalaAccountSchema>;
export type AuthenticatedDigikalaAccount = DigikalaAccountRecord & {
  credentials: DigikalaCredentials & { tokens: DigikalaTokens };
  authentication: Extract<AuthenticationState, { status: 'authenticated' }>;
};

export interface VendorSummary {
  id: string;
  name: string;
  sellerCode: string;
  authenticationStatus: AuthenticationState['status'];
  scopes: string[];
  accessTokenExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReauthorizationReason = Extract<
  AuthenticationState,
  { status: 'reauthorization_required' }
>['reason'];

export interface TokenExchange {
  (authorizationCode: string): Promise<unknown>;
}

export interface TokenRefreshExchangeInput {
  accessToken: string;
  refreshToken: string;
  sellerCode: string;
}

export interface TokenRefreshExchange {
  (input: TokenRefreshExchangeInput): Promise<unknown>;
}
