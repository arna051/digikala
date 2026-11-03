export {
  NonNegativeIntegerSchema,
  PagerSchema,
  PaginationSchema,
  PositiveIdSchema,
  PositiveMoneySchema,
  apiResponseSchema,
  listResponseSchema,
} from './common.js';
export {
  DigikalaRequestValidationError,
  DigikalaResponseValidationError,
  DigikalaValidationError,
  DigikalaWebhookValidationError,
} from './errors.js';
export type { DigikalaValidationIssue } from './errors.js';
export { createValidatedOperation } from './operation.js';
export { ResourceSchemas } from './resources.js';
export { KnownWebhookEventSchema, WebhookSchemas } from './webhooks.js';
export type {
  DigikalaWebhookEvent,
  OrdersListInput,
  ProductsListInput,
  VariantActivationInput,
  VariantPriceUpdateInput,
  VariantStockUpdateInput,
  VariantsListInput,
} from './types.js';

import { PaginationSchema } from './common.js';
import { ResourceSchemas } from './resources.js';
import { WebhookSchemas } from './webhooks.js';

export const Schemas = Object.freeze({
  Pagination: PaginationSchema,
  ...ResourceSchemas,
  Webhooks: WebhookSchemas,
});
