import { constants, publicEncrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DigikalaAccount,
  DigikalaAuth,
  DigikalaAuthenticationTransitionError,
  DigikalaIdentity,
} from '../src/auth/index.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const registeredAt = new Date('2026-01-02T00:00:00.000Z');
const authenticatedAt = new Date('2026-01-03T00:00:00.000Z');

describe('Digikala authentication state machine', () => {
  it('creates, registers, and authenticates a database-ready account', async () => {
    const pending = await DigikalaAuth.createAccount(
      {
        vendor: {
          id: 'vendor-1',
          name: 'Example Store',
          sellerCode: 'seller-123',
        },
      },
      { now: createdAt },
    );

    expect(pending.authentication.status).toBe('pending_public_key');
    expect(pending.revision).toBe(0);
    expect(pending.credentials.tokens).toBeNull();
    expect(DigikalaIdentity.validateKeyPair(pending.credentials)).toBe(true);

    const waiting = DigikalaAuth.markPublicKeyRegistered(pending, {
      now: registeredAt,
    });
    expect(waiting.authentication.status).toBe('waiting_for_authorization');
    expect(waiting.revision).toBe(1);

    const encryptedCode = publicEncrypt(
      {
        key: waiting.credentials.publicKey,
        padding: constants.RSA_PKCS1_PADDING,
      },
      Buffer.from('authorization-code'),
    ).toString('base64');

    const authenticated = await DigikalaAuth.completeAuthentication({
      account: waiting,
      authorizationCode: encryptedCode,
      now: authenticatedAt,
      exchange: (authorizationCode) => {
        expect(authorizationCode).toBe('authorization-code');
        return Promise.resolve({
          status: 'ok',
          data: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            access_token_expires_at: {
              date: '2026-01-03 01:00:00.000000',
              timezone_type: 3,
              timezone: 'Asia/Tehran',
            },
            refresh_token_expires_at: {
              date: '2026-07-03 00:00:00.000000',
              timezone_type: 3,
              timezone: 'Asia/Tehran',
            },
            scopes: ['product', 'variant'],
          },
        });
      },
    });

    expect(DigikalaAccount.isAuthenticated(authenticated)).toBe(true);
    expect(authenticated.authentication.status).toBe('authenticated');
    expect(authenticated.revision).toBe(2);
    expect(authenticated.credentials.tokens.accessToken).toBe('access-token');

    expect(DigikalaAccount.toVendorSummary(authenticated)).toEqual({
      id: 'vendor-1',
      name: 'Example Store',
      sellerCode: 'seller-123',
      authenticationStatus: 'authenticated',
      scopes: ['product', 'variant'],
      accessTokenExpiresAt: '2026-01-03 01:00:00.000000',
      createdAt: createdAt.toISOString(),
      updatedAt: authenticatedAt.toISOString(),
    });

    const redacted = JSON.stringify(DigikalaAccount.redact(authenticated));
    expect(redacted).not.toContain('access-token');
    expect(redacted).not.toContain('refresh-token');
    expect(redacted).not.toContain('BEGIN PRIVATE KEY');
  });

  it('rejects invalid transitions', async () => {
    const pending = await DigikalaAuth.createAccount({
      vendor: { id: 'v', name: 'Store', sellerCode: 'code' },
    });

    await expect(
      DigikalaAuth.completeAuthentication({
        account: pending,
        authorizationCode: 'not-used',
        exchange: () => Promise.resolve({}),
      }),
    ).rejects.toBeInstanceOf(DigikalaAuthenticationTransitionError);
  });

  it('removes tokens when authentication is revoked', async () => {
    const pending = await DigikalaAuth.createAccount({
      vendor: { id: 'v', name: 'Store', sellerCode: 'code' },
    });
    const revoked = DigikalaAuth.revokeLocally(pending, { now: registeredAt });

    expect(revoked.authentication.status).toBe('revoked');
    expect(revoked.credentials.tokens).toBeNull();
  });
});
