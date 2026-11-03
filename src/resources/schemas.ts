import { z } from 'zod';
import { apiResponseSchema, listResponseSchema } from '../validation/common.js';

const positiveId = z.number().int().positive();
const nullableString = z.string().nullable().optional();

export const IdInputSchema = z.object({ id: positiveId }).strict();

export const VariantSchema = z
  .object({
    id: positiveId,
    product_id: positiveId.optional(),
    product_variant_id: positiveId.optional(),
    title: z.string().optional(),
    product_title: z.string().optional(),
    supplier_code: nullableString,
    active: z.boolean().optional(),
    archived: z.boolean().optional(),
    selling_price: z.number().int().nonnegative().optional(),
    selling_stock: z.number().int().nonnegative().optional(),
    image_src: nullableString,
  })
  .passthrough();

export const ProductSchema = z
  .object({
    product_id: positiveId,
    title: z.string().optional(),
    category_id: positiveId.optional(),
    brand_id: positiveId.optional(),
    moderation_status: z
      .union([z.string(), z.object({}).passthrough()])
      .nullable()
      .optional(),
    image_src: nullableString,
  })
  .passthrough();

export const OrderSchema = z
  .object({
    order_id: positiveId,
    order_item_id: positiveId.optional(),
    product_variant_id: positiveId.optional(),
    product_title: z.string().optional(),
    quantity: z.number().int().nonnegative().optional(),
    order_created_at: z.string().optional(),
  })
  .passthrough();

export const VariantResponseSchema = apiResponseSchema(VariantSchema);
export const VariantListResponseSchema = listResponseSchema(VariantSchema);
export const ProductListResponseSchema = listResponseSchema(ProductSchema);
export const OrderListResponseSchema = listResponseSchema(OrderSchema);

export const VariantStockResponseSchema = apiResponseSchema(
  z
    .object({
      marketplace_seller_stock: z.number().int().nonnegative().optional(),
      selling_stock: z.number().int().nonnegative().optional(),
      dk_warehouse_stock: z.number().int().nonnegative().optional(),
      warehouse_stock: z.number().int().nonnegative().optional(),
      on_the_way_stock: z.number().int().nonnegative().optional(),
      reservation: z.number().int().nonnegative().optional(),
      left_consumer: z.number().int().nonnegative().optional(),
      seller_reservation: z.number().int().nonnegative().optional(),
      digikala_reservation: z.number().int().nonnegative().optional(),
    })
    .passthrough(),
);

export const VariantPriceResponseSchema = apiResponseSchema(
  z
    .object({
      variant_id: positiveId,
      selling_price: z.number().int().nonnegative(),
      credit_increase_percentage: z.number().int().nonnegative(),
    })
    .passthrough(),
);

const score = z.object({ max: z.number(), current: z.number() }).passthrough();
export const ProductScoreResponseSchema = apiResponseSchema(
  z
    .object({
      score: score,
      scores: z.object({}).passthrough().optional(),
    })
    .passthrough(),
);

export const CancelOrderInputSchema = z
  .object({
    orderItemId: positiveId,
    cancellationReasonId: z.number().int(),
    count: z.number().int().positive().optional(),
  })
  .strict();

export const CancelOrderResponseSchema = apiResponseSchema(
  z
    .object({
      message: z.string(),
      status: z.string().optional(),
      code: z.number().int().optional(),
    })
    .passthrough(),
);
