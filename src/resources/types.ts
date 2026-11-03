import type { z } from 'zod';
import type { Schemas } from '../validation/index.js';
import type {
  CancelOrderInputSchema,
  CancelOrderResponseSchema,
  OrderListResponseSchema,
  OrderSchema,
  ProductListResponseSchema,
  ProductSchema,
  ProductScoreResponseSchema,
  VariantListResponseSchema,
  VariantPriceResponseSchema,
  VariantResponseSchema,
  VariantSchema,
  VariantStockResponseSchema,
} from './schemas.js';

export type Variant = z.output<typeof VariantSchema>;
export type Product = z.output<typeof ProductSchema>;
export type Order = z.output<typeof OrderSchema>;
export type VariantListResponse = z.output<typeof VariantListResponseSchema>;
export type VariantResponse = z.output<typeof VariantResponseSchema>;
export type VariantStockResponse = z.output<typeof VariantStockResponseSchema>;
export type VariantPriceResponse = z.output<typeof VariantPriceResponseSchema>;
export type ProductListResponse = z.output<typeof ProductListResponseSchema>;
export type ProductScoreResponse = z.output<typeof ProductScoreResponseSchema>;
export type OrderListResponse = z.output<typeof OrderListResponseSchema>;
export type CancelOrderInput = z.input<typeof CancelOrderInputSchema>;
export type CancelOrderResponse = z.output<typeof CancelOrderResponseSchema>;
export type VariantsListInput = z.input<typeof Schemas.Variants.list>;
export type ProductsListInput = z.input<typeof Schemas.Products.list>;
export type OrdersListInput = z.input<typeof Schemas.Orders.list>;
