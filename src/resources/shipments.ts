import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { apiResponseSchema, listResponseSchema } from '../validation/common.js';
import { serializeListQuery } from './serialization.js';

const id = z.number().int().positive();
export const ShipmentSchema = z.object({ id: id.optional() }).passthrough();
export const ShipmentResponseSchema = apiResponseSchema(ShipmentSchema);
export const ShipmentListResponseSchema = listResponseSchema(ShipmentSchema);
export const ShipmentMutationResponseSchema = apiResponseSchema(z.unknown());

export const ShipmentListInputSchema = z
  .object({
    search: z
      .object({
        createdAtEnd: z.string().optional(),
        shipmentReceiveAtStart: z.string().optional(),
        shipmentReceiveAtEnd: z.string().optional(),
        shipmentStatus: z
          .enum(['new', 'received', 'partially_received', 'rejected', 'error'])
          .optional(),
        multiSearch: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ShipmentPackagesInputSchema = z
  .object({
    page: z.number().int().positive().default(1),
    size: z.number().int().positive().max(100).default(50),
    sort: z.literal('id').default('id'),
    order: z.enum(['asc', 'desc']).default('asc'),
    packageIds: z.array(id).optional(),
    warehouseId: id.optional(),
  })
  .strict();

export const ShipmentCreateInputSchema = z
  .object({
    packageIds: z.array(id).min(1),
    warehouseId: id,
    pickupDate: z.string().trim().min(1),
    timeScope: z.string().trim().min(1),
  })
  .strict();

export class DigikalaShipmentsResource {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

  list(input: z.input<typeof ShipmentListInputSchema> = {}) {
    return this.transport.request({
      method: 'GET',
      path: 'shipments/dk',
      input,
      inputSchema: ShipmentListInputSchema,
      outputSchema: ShipmentListResponseSchema,
      serialize: ({ search }) => ({
        params: search
          ? Object.fromEntries(
              Object.entries(search).map(([key, value]) => [
                `search[${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}]`,
                value,
              ]),
            )
          : undefined,
      }),
    });
  }

  packages(input: z.input<typeof ShipmentPackagesInputSchema> = {}) {
    return this.transport.request({
      method: 'GET',
      path: 'shipments/dk/packages',
      input,
      inputSchema: ShipmentPackagesInputSchema,
      outputSchema: ShipmentListResponseSchema,
      serialize: ({ packageIds, warehouseId, ...list }) => ({
        params: {
          ...serializeListQuery(list),
          ...(packageIds ? { package_ids: packageIds.join(',') } : {}),
          ...(warehouseId ? { 'search[warehouse_id]': warehouseId } : {}),
        },
      }),
    });
  }

  get(shipmentId: number) {
    return this.byId('GET', shipmentId, ShipmentResponseSchema);
  }

  create(input: z.input<typeof ShipmentCreateInputSchema>) {
    return this.transport.request({
      method: 'POST',
      path: 'shipments/dk',
      input,
      inputSchema: ShipmentCreateInputSchema,
      outputSchema: ShipmentMutationResponseSchema,
      serialize: ({ packageIds, warehouseId, pickupDate, timeScope }) => ({
        data: {
          package_ids: packageIds,
          warehouse_id: warehouseId,
          pickup_date: pickupDate,
          time_scope: timeScope,
        },
      }),
    });
  }

  remove(shipmentId: number) {
    return this.byId('DELETE', shipmentId, ShipmentMutationResponseSchema);
  }

  private byId(
    method: 'GET' | 'DELETE',
    shipmentId: number,
    outputSchema: z.ZodType,
  ) {
    return this.transport.request({
      method,
      path: `shipments/dk/${shipmentId}`,
      input: { shipmentId },
      inputSchema: z.object({ shipmentId: id }).strict(),
      outputSchema,
      serialize: () => ({}),
    });
  }
}
