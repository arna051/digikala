import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import {
  DIGIKALA_GENERATED_OPERATION_COUNT,
  DIGIKALA_OPENAPI_OPERATION_COUNT,
  DigikalaAxiosTransport,
  DigikalaRequestValidationError,
  DigikalaSellerApi,
  GetShipmentsDkInputSchema,
  GetShipmentsDkOutputSchema,
  GetVariantsOutputSchema,
} from '../src/node/index.js';

function setup(data: unknown = { status: 'ok', data: {} }) {
  const requests: AxiosRequestConfig[] = [];
  const adapter = vi.fn<AxiosAdapter>((config) => {
    requests.push(config);
    const response: AxiosResponse = {
      data,
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    };
    return Promise.resolve(response);
  });
  const transport = new DigikalaAxiosTransport({
    adapter,
    credentials: () => ({ accessToken: 'token', sellerCode: '123' }),
    rateLimit: false,
  });
  return { api: new DigikalaSellerApi(transport), requests, adapter };
}

describe('generated Seller OpenAPI', () => {
  it('tracks the complete official operation surface', () => {
    expect(DIGIKALA_OPENAPI_OPERATION_COUNT).toBe(283);
    expect(DIGIKALA_GENERATED_OPERATION_COUNT).toBe(277);
  });

  it('separates domains and serializes exact query notation', async () => {
    const { api, requests } = setup({
      status: 'ok',
      data: { items: [] },
    });

    await api.packages.getPackages({
      query: { page: 2, 'search[status]': 'new' },
    });

    expect(requests[0]?.url).toBe('packages');
    expect(requests[0]?.params).toEqual({
      page: 2,
      'search[status]': 'new',
    });
  });

  it('encodes path values and validates bodies before network access', async () => {
    const pathSetup = setup({ status: 'ok', data: {} });
    await pathSetup.api.categories.getCategoriesByCategoryId({
      path: { category_id: '12/34' },
    });
    expect(pathSetup.requests[0]?.url).toBe('categories/12%2F34');

    const invalid = setup();
    await expect(
      invalid.api.packages.postPackages({
        body: { packages: {} },
      } as never),
    ).rejects.toBeInstanceOf(DigikalaRequestValidationError);
    expect(invalid.adapter).not.toHaveBeenCalled();
  });

  it('accepts documented live response compatibility without loosening inputs', () => {
    expect(
      GetShipmentsDkOutputSchema.safeParse({
        status: 'ok',
        data: { meta_data: [] },
      }).success,
    ).toBe(true);
    expect(
      GetVariantsOutputSchema.safeParse({
        status: 'ok',
        data: { items: [{ created_at: { date: '2026-11-05' } }] },
      }).success,
    ).toBe(true);
    expect(
      GetShipmentsDkInputSchema.safeParse({ query: { page: 1 } }).success,
    ).toBe(false);
  });
});
