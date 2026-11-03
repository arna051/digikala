import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import {
  DigikalaAxiosTransport,
  DigikalaOrdersResource,
  DigikalaProductsResource,
  DigikalaVariantsResource,
} from '../src/node/index.js';
import { DigikalaRequestValidationError } from '../src/validation/index.js';

function axiosResponse(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function setup(data: unknown) {
  const requests: AxiosRequestConfig[] = [];
  const adapter = vi.fn<AxiosAdapter>((config) => {
    requests.push(config);
    return Promise.resolve(axiosResponse(data));
  });
  const transport = new DigikalaAxiosTransport({
    adapter,
    credentials: () => ({ accessToken: 'token', sellerCode: '123' }),
  });
  return { transport, adapter, requests };
}

describe('Seller API resources', () => {
  it('serializes variant list filters using Digikala bracket notation', async () => {
    const { transport, requests } = setup({
      status: 'ok',
      data: { items: [{ id: 12, future_field: true }] },
    });
    const variants = new DigikalaVariantsResource(transport);
    const result = await variants.list({
      search: { ids: [12, 13], categoryIds: [4, 5], active: true },
    });

    expect(result.data.items[0]?.id).toBe(12);
    expect(requests[0]?.url).toBe('variants');
    expect(requests[0]?.params).toMatchObject({
      page: 1,
      size: 50,
      sort: 'id',
      'search[ids]': '12_13',
      'search[category_ids]': '4,5',
      'search[active]': true,
    });
    await expect(variants.list({ size: 51 })).rejects.toBeInstanceOf(
      DigikalaRequestValidationError,
    );
  });

  it('maps variant mutations to documented methods, paths, and snake-case bodies', async () => {
    const { transport, requests } = setup({
      status: 'ok',
      data: {
        variant_id: 9,
        selling_price: 2000,
        credit_increase_percentage: 5,
      },
    });
    const variants = new DigikalaVariantsResource(transport);
    await variants.updatePrice({
      variantId: 9,
      sellingPrice: 2000,
      creditIncreasePercentage: 5,
    });

    expect(requests[0]?.method).toBe('patch');
    expect(requests[0]?.url).toBe('variants/selling-price');
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      variant_id: 9,
      selling_price: 2000,
      credit_increase_percentage: 5,
    });
  });

  it('uses the seller product endpoint and validates product ids locally', async () => {
    const { transport, adapter, requests } = setup({
      status: 'ok',
      data: { items: [{ product_id: 2, title: 'Product' }] },
    });
    const products = new DigikalaProductsResource(transport);
    await products.list({ search: { term: 'shoe' } });
    expect(requests[0]?.url).toBe('products/seller');
    expect(requests[0]?.params).toMatchObject({
      'search[multi_search]': 'shoe',
    });

    await expect(products.getScore(-1)).rejects.toBeInstanceOf(
      DigikalaRequestValidationError,
    );
    expect(adapter).toHaveBeenCalledOnce();
  });

  it('accepts structured moderation status from seller products', async () => {
    const { transport } = setup({
      status: 'ok',
      data: {
        items: [
          {
            product_id: 23142759,
            title: 'Example product',
            moderation_status: {
              status: 'approved',
              title: 'Approved',
            },
          },
        ],
      },
    });
    const products = new DigikalaProductsResource(transport);

    await expect(products.list({ page: 1, size: 1 })).resolves.toMatchObject({
      data: {
        items: [
          {
            product_id: 23142759,
            moderation_status: { status: 'approved' },
          },
        ],
      },
    });
  });

  it('lists and cancels order items through documented operations', async () => {
    const listSetup = setup({
      status: 'ok',
      data: { items: [{ order_id: 20, product_variant_id: 3 }] },
    });
    await new DigikalaOrdersResource(listSetup.transport).list({
      search: { createdToday: true },
    });
    expect(listSetup.requests[0]?.params).toMatchObject({
      order: 'desc',
      'search[created_today]': true,
    });

    const cancelSetup = setup({
      status: 'ok',
      data: { message: 'order was cancelled successfully' },
    });
    await new DigikalaOrdersResource(cancelSetup.transport).cancel({
      orderItemId: 3,
      cancellationReasonId: -1,
      count: 2,
    });
    expect(cancelSetup.requests[0]?.method).toBe('delete');
    expect(cancelSetup.requests[0]?.url).toBe('orders/3');
    expect(JSON.parse(String(cancelSetup.requests[0]?.data))).toEqual({
      cancellation_reason_id: -1,
      count: 2,
    });
  });
});
