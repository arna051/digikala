import type { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import type {
  DigikalaCacheManager,
  DigikalaReadOptions,
} from '../cache/index.js';
import { Schemas } from '../validation/index.js';
import { serializeListQuery } from './serialization.js';
import {
  IdInputSchema,
  ProductListResponseSchema,
  ProductScoreResponseSchema,
} from './schemas.js';

export class DigikalaProductsResource {
  constructor(
    private readonly transport: DigikalaAxiosTransport,
    private readonly cache?: DigikalaCacheManager,
  ) {}

  list(
    input: z.input<typeof Schemas.Products.list> = {},
    options?: DigikalaReadOptions,
  ) {
    const cacheInput = Schemas.Products.list.safeParse(input);
    const load = () =>
      this.transport.request({
        method: 'GET',
        path: 'products/seller',
        input,
        inputSchema: Schemas.Products.list,
        outputSchema: ProductListResponseSchema,
        serialize: (parsed) => ({
          params: serializeListQuery(parsed, { term: 'multi_search' }),
        }),
      });
    return this.cache
      ? this.cache.readThrough(
          'products',
          cacheInput.success ? cacheInput.data : input,
          options,
          load,
        )
      : load();
  }

  getScore(productId: number, options?: DigikalaReadOptions) {
    const load = () =>
      this.transport.request({
        method: 'GET',
        path: `products/${productId}/score`,
        input: { id: productId },
        inputSchema: IdInputSchema,
        outputSchema: ProductScoreResponseSchema,
        serialize: () => ({}),
      });
    return this.cache
      ? this.cache.readThrough('product-score', { productId }, options, load)
      : load();
  }
}
