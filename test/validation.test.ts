import { describe, expect, it, vi } from 'vitest';
import {
  DigikalaRequestValidationError,
  DigikalaResponseValidationError,
  KnownWebhookEventSchema,
  Schemas,
  createValidatedOperation,
  listResponseSchema,
} from '../src/validation/index.js';
import { z } from 'zod';

describe('public validation schemas', () => {
  it('lets users validate and normalize valid request data', () => {
    const parsed = Schemas.Variants.list.parse({});
    expect(parsed).toMatchObject({ page: 1, size: 50, sort: 'id' });

    expect(
      Schemas.Variants.updateStock.safeParse({
        variantId: 123,
        sellerStock: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects unknown and invalid outgoing fields', () => {
    const result = Schemas.Variants.updatePrice.safeParse({
      variantId: 1,
      sellingPrice: -1,
      creditIncreasePercentage: 20,
      accessToken: 'must-not-be-forwarded',
    });
    expect(result.success).toBe(false);
  });

  it('accepts additive fields in API responses', () => {
    const response = listResponseSchema(
      z.object({ id: z.number() }).passthrough(),
    );
    const parsed = response.parse({
      status: 'ok',
      data: { items: [{ id: 1, future_field: true }], future_meta: true },
      future_root: true,
    });
    expect(parsed.data.items[0]?.id).toBe(1);
  });

  it('validates all documented webhook event families', () => {
    const shipment = {
      order_shipment_id: 1,
      product_variant_ids: [2],
      quantities_per_variant: { '2': { count: 1 } },
    };
    const packageData = {
      seller_package_id: 1,
      seller_package_status: 'new',
      seller_package_items: {
        '2': {
          product_variant_id: 2,
          status: 'new',
          real_count: 1,
          expected_count: 1,
          tags: [],
          created_at: '2024-12-16 15:58:09',
        },
      },
    };
    const events = [
      {
        event_type: 'product_variant_status_change',
        data: {
          product_variant_id: 2,
          product_variant_title: 'Variant',
          product_id: 3,
          active: true,
          deactivation_reason: null,
          seller_id: 4,
        },
      },
      {
        event_type: 'order_shipment_digikala',
        data: { ...shipment, shipping_type: 'digikala' },
      },
      {
        event_type: 'order_shipment_seller',
        data: { ...shipment, shipping_type: 'seller' },
      },
      {
        event_type: 'seller_package_status_change_order_fulfilment',
        data: { ...packageData, seller_package_type: 'order_fulfilment' },
      },
      {
        event_type: 'seller_package_status_change_consignment',
        data: { ...packageData, seller_package_type: 'consignment' },
      },
      {
        event_type: 'commission_change',
        data: {
          main_category_id: 1,
          category_id: 2,
          brand_id: null,
          standard_commission: 0.1,
        },
      },
    ];

    for (const event of events) {
      expect(KnownWebhookEventSchema.safeParse(event).success).toBe(true);
    }

    expect(
      KnownWebhookEventSchema.safeParse({
        event_type: 'order_shipment_seller',
        data: { ...shipment, shipping_type: 'digikala' },
      }).success,
    ).toBe(false);
  });
});

describe('validated operations', () => {
  it('never calls transport when request validation fails', async () => {
    const execute = vi.fn(() => Promise.resolve({ status: 'ok' }));
    const operation = createValidatedOperation({
      input: z.object({ id: z.number().positive() }).strict(),
      output: z.object({ status: z.literal('ok') }).passthrough(),
      execute,
    });

    await expect(operation({ id: -1 })).rejects.toBeInstanceOf(
      DigikalaRequestValidationError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('validates the transport response', async () => {
    const operation = createValidatedOperation({
      input: z.object({ id: z.number() }),
      output: z.object({ status: z.literal('ok') }),
      execute: () => Promise.resolve({ status: 'invalid' }),
    });

    await expect(operation({ id: 1 })).rejects.toBeInstanceOf(
      DigikalaResponseValidationError,
    );
  });

  it('does not retain raw sensitive input on validation errors', async () => {
    const operation = createValidatedOperation({
      input: z.object({ count: z.number() }).strict(),
      output: z.unknown(),
      execute: () => Promise.resolve(null),
    });

    try {
      await operation({ count: 'secret-token' } as never);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('secret-token');
    }
  });
});
