import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { apiResponseSchema } from '../validation/common.js';

const id = z.number().int().positive();
const response = apiResponseSchema(z.object({}).passthrough());

const ProductFieldsSchema = z.object({
  categoryId: id,
  divisionId: id.optional(),
  model: z.string().optional(),
  brandId: id,
  referenceBrandId: id.nullable().optional(),
  productTypeIds: z.array(id).optional(),
  colorId: id.optional(),
  isIranian: z.boolean(),
  productClasses: z.array(id).optional(),
  fake: z.boolean().optional(),
  generalMefaId: z.string().optional(),
  exclusiveMefaId: z.string().optional(),
  packageWidth: z.number().int().positive().optional(),
  packageHeight: z.number().int().positive().optional(),
  packageLength: z.number().int().positive().optional(),
  packageWeight: z.number().int().positive().optional(),
  description: z.string().optional(),
  disadvantages: z.array(z.string()).optional(),
  advantages: z.array(z.string()).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  length: z.number().int().positive().optional(),
  weight: z.number().int().positive().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  titleFa: z.string().optional(),
  titleEn: z.string().optional(),
  useTempImages: z.boolean().optional(),
  photosDetail: z.record(z.string(), z.unknown()).optional(),
  videoIds: z.array(z.string()).optional(),
});

export const ProductEditInputSchema = ProductFieldsSchema.extend({
  productId: id,
}).strict();

export const ProductEditAutoTitleInputSchema = z
  .object({
    categoryId: id,
    divisionId: id.optional(),
    model: z.string().optional(),
    brandId: id,
    productTypeIds: z.array(id).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ProductPublishInputSchema = z
  .object({
    productId: id,
    forceMarketplaceSellerId: id.optional(),
  })
  .strict();

function snakeCaseRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      item,
    ]),
  );
}

export class DigikalaProductEditingResource {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

  get(productId: number) {
    return this.transport.request({
      method: 'GET',
      path: `product-edit/${productId}`,
      input: { productId },
      inputSchema: z.object({ productId: id }).strict(),
      outputSchema: response,
      serialize: () => ({}),
    });
  }

  update(input: z.input<typeof ProductEditInputSchema>) {
    return this.transport.request({
      method: 'PUT',
      path: `product-edit/${input.productId}`,
      input,
      inputSchema: ProductEditInputSchema,
      outputSchema: response,
      serialize: (value) => {
        const fields: Record<string, unknown> = { ...value };
        delete fields.productId;
        return { data: snakeCaseRecord(fields) };
      },
    });
  }

  publish(input: z.input<typeof ProductPublishInputSchema>) {
    return this.transport.request({
      method: 'POST',
      path: `product-edit/${input.productId}/publish`,
      input,
      inputSchema: ProductPublishInputSchema,
      outputSchema: response,
      serialize: ({ forceMarketplaceSellerId }) => ({
        data:
          forceMarketplaceSellerId === undefined
            ? {}
            : { force_marketplace_seller_id: forceMarketplaceSellerId },
      }),
    });
  }

  suggestTitle(input: z.input<typeof ProductEditAutoTitleInputSchema>) {
    return this.transport.request({
      method: 'POST',
      path: `product-edit/${input.categoryId}/auto-title`,
      input,
      inputSchema: ProductEditAutoTitleInputSchema,
      outputSchema: response,
      serialize: (value) => {
        const fields: Record<string, unknown> = { ...value };
        delete fields.categoryId;
        return { data: snakeCaseRecord(fields) };
      },
    });
  }
}
