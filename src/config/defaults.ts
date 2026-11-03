import type { DigikalaClientOptions } from '../types/index.js';

export const DIGIKALA_OPEN_API_BASE_URL =
  'https://seller.digikala.com/open-api/v1';

export const DEFAULT_TIMEOUT_MS = 60_000;

export const DEFAULT_OPTIONS: Required<DigikalaClientOptions> = {
  baseUrl: DIGIKALA_OPEN_API_BASE_URL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};
