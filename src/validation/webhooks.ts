import { z } from 'zod';
import { NonNegativeIntegerSchema, PositiveIdSchema } from './common.js';

const envelope = <TType extends string, TData extends z.ZodType>(
  eventType: TType,
  data: TData,
) => z.object({ event_type: z.literal(eventType), data }).passthrough();

const ProductVariantStatusChangeSchema = envelope(
  'product_variant_status_change',
  z
    .object({
      product_variant_id: PositiveIdSchema,
      product_variant_title: z.string(),
      product_id: PositiveIdSchema,
      active: z.boolean(),
      deactivation_reason: z.string().nullable(),
      seller_id: PositiveIdSchema,
    })
    .passthrough(),
);

const ShipmentDataSchema = z
  .object({
    order_shipment_id: PositiveIdSchema,
    shipping_type: z.enum(['digikala', 'seller']),
    product_variant_ids: z.array(PositiveIdSchema),
    quantities_per_variant: z.record(
      z.string(),
      z.object({ count: NonNegativeIntegerSchema }).passthrough(),
    ),
  })
  .passthrough();

const DigikalaShipmentDataSchema = ShipmentDataSchema.extend({
  shipping_type: z.literal('digikala'),
});

const SellerShipmentDataSchema = ShipmentDataSchema.extend({
  shipping_type: z.literal('seller'),
});

const PackageDataSchema = z
  .object({
    seller_package_id: PositiveIdSchema,
    seller_package_status: z.string().min(1),
    seller_package_type: z.enum(['order_fulfilment', 'consignment']),
    seller_package_items: z.record(
      z.string(),
      z
        .object({
          product_variant_id: PositiveIdSchema,
          status: z.string().min(1),
          real_count: NonNegativeIntegerSchema,
          expected_count: NonNegativeIntegerSchema,
          tags: z.array(z.string()),
          created_at: z.string().min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const OrderFulfilmentPackageDataSchema = PackageDataSchema.extend({
  seller_package_type: z.literal('order_fulfilment'),
});

const ConsignmentPackageDataSchema = PackageDataSchema.extend({
  seller_package_type: z.literal('consignment'),
});

const CommissionChangeSchema = envelope(
  'commission_change',
  z
    .object({
      main_category_id: PositiveIdSchema.nullable(),
      category_id: PositiveIdSchema,
      brand_id: PositiveIdSchema.nullable(),
      standard_commission: z.number().nonnegative(),
    })
    .passthrough(),
);

export const KnownWebhookEventSchema = z.discriminatedUnion('event_type', [
  ProductVariantStatusChangeSchema,
  envelope('order_shipment_digikala', DigikalaShipmentDataSchema),
  envelope('order_shipment_seller', SellerShipmentDataSchema),
  envelope(
    'seller_package_status_change_order_fulfilment',
    OrderFulfilmentPackageDataSchema,
  ),
  envelope(
    'seller_package_status_change_consignment',
    ConsignmentPackageDataSchema,
  ),
  CommissionChangeSchema,
]);

export const WebhookSchemas = Object.freeze({
  event: KnownWebhookEventSchema,
  productVariantStatusChange: ProductVariantStatusChangeSchema,
  orderShipmentDigikala: envelope(
    'order_shipment_digikala',
    DigikalaShipmentDataSchema,
  ),
  orderShipmentSeller: envelope(
    'order_shipment_seller',
    SellerShipmentDataSchema,
  ),
  packageOrderFulfilment: envelope(
    'seller_package_status_change_order_fulfilment',
    OrderFulfilmentPackageDataSchema,
  ),
  packageConsignment: envelope(
    'seller_package_status_change_consignment',
    ConsignmentPackageDataSchema,
  ),
  commissionChange: CommissionChangeSchema,
});
