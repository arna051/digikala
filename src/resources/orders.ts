import type { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { Schemas } from '../validation/index.js';
import { serializeListQuery } from './serialization.js';
import {
  CancelOrderInputSchema,
  CancelOrderResponseSchema,
  OrderListResponseSchema,
} from './schemas.js';

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
