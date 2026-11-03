import type { z } from 'zod';
import type { ResourceSchemas } from './resources.js';
import type { KnownWebhookEventSchema } from './webhooks.js';

export type VariantsListInput = z.input<typeof ResourceSchemas.Variants.list>;
export type VariantStockUpdateInput = z.input<
  typeof ResourceSchemas.Variants.updateStock
>;
export type VariantPriceUpdateInput = z.input<
  typeof ResourceSchemas.Variants.updatePrice
>;
export type VariantActivationInput = z.input<
  typeof ResourceSchemas.Variants.updateActivation
>;
export type ProductsListInput = z.input<typeof ResourceSchemas.Products.list>;
export type OrdersListInput = z.input<typeof ResourceSchemas.Orders.list>;
export type DigikalaWebhookEvent = z.output<typeof KnownWebhookEventSchema>;
