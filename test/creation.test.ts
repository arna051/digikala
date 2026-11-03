import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import {
  advanceCreationWorkflow,
  createCreationWorkflow,
  DigikalaAxiosTransport,
  DigikalaProductCreationResource,
  DigikalaVariantCreationResource,
  DigikalaVariantsResource,
} from '../src/node/index.js';
import { DigikalaRequestValidationError } from '../src/validation/index.js';
import {
  ProductDetailsInputSchema as PublicProductDetailsInputSchema,
  VariantCreateInputSchema as PublicVariantCreateInputSchema,
} from '../src/schemas/index.js';

function response(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function setup() {
  const requests: AxiosRequestConfig[] = [];
  const adapter = vi.fn<AxiosAdapter>((config) => {
    requests.push(config);
    return Promise.resolve(response({ status: 'ok', data: { id: 1 } }));
  });
  const transport = new DigikalaAxiosTransport({
    adapter,
    credentials: () => ({ accessToken: 'token', sellerCode: '123' }),
  });
  return { transport, requests };
}

describe('Product and variant creation', () => {
  it('exposes database-safe creation schemas without the Node client', () => {
    expect(
      PublicProductDetailsInputSchema.safeParse({
        categoryId: 10,
        brandId: 20,
        isIranian: false,
      }).success,
    ).toBe(true);
    expect(
      PublicVariantCreateInputSchema.safeParse({
        productId: 100,
        isActive: false,
        orderLimit: 2,
        marketplaceSellerStock: 0,
        warrantyId: 2,
        site: 'digikala',
        shippingType: 'seller',
      }).success,
    ).toBe(true);
  });

  it('serializes product discovery and strict draft details', async () => {
    const { transport, requests } = setup();
    const creation = new DigikalaProductCreationResource(transport);
    await creation.search({ keyword: 'shoe', categories: [1, 2] });
    expect(requests[0]?.url).toBe('product-creation/search/v2');
    expect(requests[0]?.params).toMatchObject({
      'search[keyword]': 'shoe',
      'search[categories]': '1,2',
    });

    await creation.validateDetails({
      categoryId: 10,
      brandId: 20,
      isIranian: false,
      packageWeight: 300,
    });
    expect(JSON.parse(String(requests[1]?.data))).toMatchObject({
      category_id: 10,
      brand_id: 20,
      is_iranian: false,
      package_weight: 300,
    });
  });

  it('creates an inactive zero-stock variant without leaking productId into the body', async () => {
    const { transport, requests } = setup();
    const creation = new DigikalaVariantCreationResource(transport);
    await creation.create({
      productId: 100,
      isActive: false,
      orderLimit: 2,
      marketplaceSellerStock: 0,
      warrantyId: 2,
      site: 'digikala',
      shippingType: 'seller',
    });
    expect(requests[0]?.url).toBe('variants/creation/100');
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      is_active: false,
      order_limit: 2,
      marketplace_seller_stock: 0,
      warranty_id: 2,
      site: 'digikala',
      shipping_type: 'seller',
    });

    await expect(
      creation.create({
        productId: 100,
        isActive: false,
        orderLimit: 1,
        marketplaceSellerStock: 0,
        warrantyId: 2,
        site: 'digikala',
        shippingType: 'seller',
      }),
    ).rejects.toBeInstanceOf(DigikalaRequestValidationError);
  });

  it('archives a variant with the documented generic mutation response', async () => {
    const { transport, requests } = setup();
    const variants = new DigikalaVariantsResource(transport);

    await expect(variants.archive(123)).resolves.toMatchObject({
      status: 'ok',
    });
    expect(requests[0]?.method).toBe('put');
    expect(requests[0]?.url).toBe('variants/123/archive');
    expect(JSON.parse(String(requests[0]?.data))).toEqual({ archive: true });
  });

  it('advances a serializable workflow through moderation and creation', () => {
    let state = createCreationWorkflow({
      vendorId: 'vendor-1',
      mode: 'new_product',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    state = advanceCreationWorkflow(state, {
      type: 'details_validated',
      draftProductId: 5,
    });
    state = advanceCreationWorkflow(state, { type: 'attributes_validated' });
    state = advanceCreationWorkflow(state, { type: 'images_uploaded' });
    state = advanceCreationWorkflow(state, { type: 'product_submitted' });
    state = advanceCreationWorkflow(state, {
      type: 'product_approved',
      productId: 10,
    });
    state = advanceCreationWorkflow(state, {
      type: 'variant_created',
      variantId: 20,
    });
    expect(state).toMatchObject({
      status: 'completed',
      draftProductId: 5,
      productId: 10,
      variantId: 20,
    });
    expect(() => JSON.stringify(state)).not.toThrow();
  });
});
