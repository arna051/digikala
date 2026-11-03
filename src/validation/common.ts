import { z } from 'zod';

export const PositiveIdSchema = z.number().int().positive();
export const NonNegativeIntegerSchema = z.number().int().nonnegative();
export const PositiveMoneySchema = z.number().int().positive();

export const PaginationSchema = z
  .object({
    page: z.number().int().positive().default(1),
    size: z.number().int().positive().default(50),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export const PagerSchema = z
  .object({
    page: z.number().int(),
    item_per_page: z.number().int(),
    total_pages: z.number().int().optional(),
    total_rows: z.number().int().optional(),
  })
  .passthrough();

export function apiResponseSchema<TData extends z.ZodType>(data: TData) {
  return z
    .object({
      status: z.union([z.string(), z.number()]),
      data,
    })
    .passthrough();
}

export function listResponseSchema<TItem extends z.ZodType>(item: TItem) {
  return apiResponseSchema(
    z
      .object({
        items: z.array(item),
        pager: PagerSchema.optional(),
      })
      .passthrough(),
  );
}
