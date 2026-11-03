import type { DigikalaTokens } from './types.js';

interface TokenExpiry {
  date: string;
  timezone: string;
}

const TIMEZONE_OFFSETS: Readonly<Record<string, string>> = Object.freeze({
  UTC: 'Z',
  'Etc/UTC': 'Z',
  'Asia/Tehran': '+03:30',
});

export function tokenExpiryMs(expiry: TokenExpiry): number {
  const raw = expiry.date.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalizedDate = raw.replace(' ', 'T');
  const offset = hasOffset ? '' : TIMEZONE_OFFSETS[expiry.timezone];
  if (!hasOffset && offset === undefined) {
    throw new TypeError(`Unsupported token timezone: ${expiry.timezone}`);
  }
  const milliseconds = Date.parse(`${normalizedDate}${offset ?? ''}`);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('Invalid Digikala token expiry date');
  }
  return milliseconds;
}

export function isAccessTokenExpiring(
  tokens: DigikalaTokens,
  now: Date = new Date(),
  skewMs = 5 * 60 * 1_000,
): boolean {
  return tokenExpiryMs(tokens.accessTokenExpiresAt) <= now.getTime() + skewMs;
}

export function isRefreshTokenExpired(
  tokens: DigikalaTokens,
  now: Date = new Date(),
): boolean {
  return tokenExpiryMs(tokens.refreshTokenExpiresAt) <= now.getTime();
}
