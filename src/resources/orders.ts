import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { Schemas } from '../validation/index.js';
import { serializeListQuery } from './serialization.js';
import {
  CancelOrderInputSchema,
  CancelOrderResponseSchema,
  OrderListResponseSchema,
} from './schemas.js';

const OrderHistoryInputSchema = z
  .object({
    page: z.number().int().positive().default(1),
    size: z.number().int().min(10).max(100).default(50),
    sort: z.literal('id').default('id'),
    order: z.enum(['asc', 'desc']).default('asc'),
    orderType: z.enum(['processed', 'returned', 'canceled']).optional(),
    categoryId: z.number().int().positive().optional(),
    orderCreatedAtTo: z.string().optional(),
    orderCreatedAtFrom: z.string().optional(),
    exitFromWarehouseDateTo: z.string().optional(),
    exitFromWarehouseDateFrom: z.string().optional(),
    returnedToWarehouseDateTo: z.string().optional(),
    returnedToWarehouseDateFrom: z.string().optional(),
    shippingType: z.enum(['seller', 'digikala', 'nearby']).optional(),
    searchTextAll: z.union([z.string(), z.number()]).optional(),
    b2bActive: z.boolean().optional(),
  })
  .strict();

const OrderStatisticsResponseSchema = z
  .object({ status: z.union([z.string(), z.number()]) })
  .passthrough();

export class DigikalaOrdersResource {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

  list(input: z.input<typeof Schemas.Orders.list> = {}) {
    return this.transport.request({
      method: 'GET',
      path: 'orders',
      input,
      inputSchema: Schemas.Orders.list,
      outputSchema: OrderListResponseSchema,
      serialize: (parsed) => ({
        params: serializeListQuery(parsed, { term: 'search_term' }),
      }),
    });
  }

  statistics() {
    return this.transport.request({
      method: 'GET',
      path: 'orders/statistics',
      input: {},
      inputSchema: z.object({}).strict(),
      outputSchema: OrderStatisticsResponseSchema,
      serialize: () => ({}),
    });
  }

  history(input: z.input<typeof OrderHistoryInputSchema> = {}) {
    return this.transport.request({
      method: 'GET',
      path: 'orders/history',
      input,
      inputSchema: OrderHistoryInputSchema,
      outputSchema: OrderListResponseSchema,
      serialize: ({ page, size, sort, order, ...filters }) => ({
        params: {
          page,
          size,
          sort,
          order,
          ...Object.fromEntries(
            Object.entries(filters)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [
                key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
                value,
              ]),
          ),
        },
      }),
    });
  }

  cancel(input: z.input<typeof CancelOrderInputSchema>) {
    return this.transport.request({
      method: 'DELETE',
      path: `orders/${input.orderItemId}`,
      input,
      inputSchema: CancelOrderInputSchema,
      outputSchema: CancelOrderResponseSchema,
      serialize: ({ cancellationReasonId, count }) => ({
        data: {
          cancellation_reason_id: cancellationReasonId,
          ...(count === undefined ? {} : { count }),
        },
      }),
    });
  }
}
