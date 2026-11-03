import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import type {
  DigikalaCacheManager,
  DigikalaReadOptions,
} from '../cache/index.js';
import { Schemas } from '../validation/index.js';
import { serializeListQuery } from './serialization.js';
import {
  IdInputSchema,
  VariantListResponseSchema,
  VariantPriceResponseSchema,
  VariantResponseSchema,
  VariantStockResponseSchema,
} from './schemas.js';
import { CreationResponseSchema } from './creation-schemas.js';

export class DigikalaVariantsResource {
  constructor(
    private readonly transport: DigikalaAxiosTransport,
    private readonly cache?: DigikalaCacheManager,
  ) {}

  list(
    input: z.input<typeof Schemas.Variants.list> = {},
    options?: DigikalaReadOptions,
  ) {
    const cacheInput = Schemas.Variants.list.safeParse(input);
    const load = () =>
      this.transport.request({
        method: 'GET',
        path: 'variants',
        input,
        inputSchema: Schemas.Variants.list,
        outputSchema: VariantListResponseSchema,
        serialize: (parsed) => ({ params: serializeListQuery(parsed) }),
      });
    return this.cache
      ? this.cache.readThrough(
          'variants',
          cacheInput.success ? cacheInput.data : input,
          options,
          load,
        )
      : load();
  }

  get(variantId: number, options?: DigikalaReadOptions) {
    const load = () =>
      this.transport.request({
        method: 'GET',
        path: `variants/${variantId}`,
        input: { id: variantId },
        inputSchema: IdInputSchema,
        outputSchema: VariantResponseSchema,
        serialize: () => ({}),
      });
    return this.cache
      ? this.cache.readThrough('variant', { variantId }, options, load)
      : load();
  }

  getStock(variantId: number, options?: DigikalaReadOptions) {
    const load = () =>
      this.transport.request({
        method: 'GET',
        path: `variants/${variantId}/seller-stock`,
        input: { id: variantId },
        inputSchema: IdInputSchema,
        outputSchema: VariantStockResponseSchema,
        serialize: () => ({}),
      });
    return this.cache
      ? this.cache.readThrough('variant-stock', { variantId }, options, load)
      : load();
  }

  updateStock(input: z.input<typeof Schemas.Variants.updateStock>) {
    return this.transport
      .request({
        method: 'PATCH',
        path: `variants/${input.variantId}/seller-stock`,
        input,
        inputSchema: Schemas.Variants.updateStock,
        outputSchema: VariantStockResponseSchema,
        serialize: ({ sellerStock }) => ({
          data: { seller_stock: sellerStock },
        }),
      })
      .then(async (result) => {
        await Promise.all([
          this.cache?.invalidate('variants'),
          this.cache?.invalidate('variant'),
          this.cache?.invalidate('variant-stock'),
        ]);
        return result;
      });
  }

  updatePrice(input: z.input<typeof Schemas.Variants.updatePrice>) {
    return this.transport
      .request({
        method: 'PATCH',
        path: 'variants/selling-price',
        input,
        inputSchema: Schemas.Variants.updatePrice,
        outputSchema: VariantPriceResponseSchema,
        serialize: ({ variantId, sellingPrice, creditIncreasePercentage }) => ({
          data: {
            variant_id: variantId,
            selling_price: sellingPrice,
            credit_increase_percentage: creditIncreasePercentage,
          },
        }),
      })
      .then(async (result) => {
        await Promise.all([
          this.cache?.invalidate('variants'),
          this.cache?.invalidate('variant'),
        ]);
        return result;
      });
  }

  updateActivation(input: z.input<typeof Schemas.Variants.updateActivation>) {
    return this.transport
      .request({
        method: 'PUT',
        path: `variants/${input.variantId}/activation`,
        input,
        inputSchema: Schemas.Variants.updateActivation,
        outputSchema: VariantResponseSchema,
        serialize: ({ activation }) => ({ data: { activation } }),
      })
      .then(async (result) => {
        await Promise.all([
          this.cache?.invalidate('variants'),
          this.cache?.invalidate('variant'),
        ]);
        return result;
      });
  }

  archive(variantId: number, archived = true) {
    return this.transport
      .request({
        method: 'PUT',
        path: `variants/${variantId}/archive`,
        input: { id: variantId, archived },
        inputSchema: IdInputSchema.extend({ archived: z.boolean() }),
        outputSchema: CreationResponseSchema,
        serialize: ({ archived: value }) => ({
          data: { archive: value },
        }),
      })
      .then(async (result) => {
        await Promise.all([
          this.cache?.invalidate('variants'),
          this.cache?.invalidate('variant'),
          this.cache?.invalidate('variant-stock'),
        ]);
        return result;
      });
  }
}
