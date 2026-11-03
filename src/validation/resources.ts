import { z } from 'zod';
import {
  NonNegativeIntegerSchema,
  PositiveIdSchema,
  PositiveMoneySchema,
  listResponseSchema,
} from './common.js';

const paginationFields = {
  page: z.number().int().positive().default(1),
  size: z.number().int().positive().default(50),
  order: z.enum(['asc', 'desc']).optional(),
};

const VariantsListRequestSchema = z
  .object({
    ...paginationFields,
    size: z.number().int().positive().max(50).default(50),
    sort: z
      .enum([
        'id',
        'product_variant_id',
        'selling_stock',
        'selling_price',
        'marketplace_seller_stock',
        'warehouse_stock',
        'created_at',
      ])
      .default('id'),
    search: z
      .object({
        id: PositiveIdSchema.optional(),
        ids: z.array(PositiveIdSchema).optional(),
        shippingType: z.enum(['seller', 'digikala', 'both']).optional(),
        active: z.boolean().optional(),
        moderationStatus: z.string().trim().min(1).optional(),
        categoryIds: z.array(PositiveIdSchema).optional(),
        buyBoxWinner: z
          .enum(['product', 'no_winner', 'sku', 'suppressed'])
          .optional(),
        inCompetition: z.boolean().optional(),
        searchTerm: z.string().trim().min(1).optional(),
        outOfStock: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const VariantStockUpdateRequestSchema = z
  .object({
    variantId: PositiveIdSchema,
    sellerStock: NonNegativeIntegerSchema,
  })
  .strict();

const VariantPriceUpdateRequestSchema = z
  .object({
    variantId: PositiveIdSchema,
    sellingPrice: PositiveMoneySchema,
    creditIncreasePercentage: z.number().int().min(0).max(100),
  })
  .strict();

const VariantActivationRequestSchema = z
  .object({
    variantId: PositiveIdSchema,
    activation: z.boolean(),
  })
  .strict();

const ProductsListRequestSchema = z
  .object({
    ...paginationFields,
    size: z.number().int().positive().max(100).default(50),
    sort: z.literal('id').default('id'),
    search: z
      .object({
        term: z.string().trim().min(1).optional(),
        categoryId: PositiveIdSchema.optional(),
        brandId: PositiveIdSchema.optional(),
        moderationStatus: z
          .enum([
            'draft',
            'in_review',
            'waiting_for_confirm',
            'edit_after_approved',
            'approved',
            'in_review_after_approved',
            'removed',
            'duplicate',
          ])
          .optional(),
        fakeStatus: z.enum(['fake', 'real']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const OrdersListRequestSchema = z
  .object({
    ...paginationFields,
    size: z.number().int().positive().max(100).default(50),
    sort: z.literal('order_created_at').default('order_created_at'),
    order: z.enum(['asc', 'desc']).default('desc'),
    search: z
      .object({
        term: z.string().trim().min(1).optional(),
        createdToday: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const UnknownItemSchema = z.object({}).passthrough();
const ListResponseSchema = listResponseSchema(UnknownItemSchema);

export const ResourceSchemas = Object.freeze({
  Variants: Object.freeze({
    list: VariantsListRequestSchema,
    updateStock: VariantStockUpdateRequestSchema,
    updatePrice: VariantPriceUpdateRequestSchema,
    updateActivation: VariantActivationRequestSchema,
    listResponse: ListResponseSchema,
  }),
  Products: Object.freeze({
    list: ProductsListRequestSchema,
    listResponse: ListResponseSchema,
  }),
  Orders: Object.freeze({
    list: OrdersListRequestSchema,
    listResponse: ListResponseSchema,
  }),
});
