import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { IdInputSchema } from './schemas.js';
import {
  CreationResponseSchema,
  ThemeValuesInputSchema,
  VariantCreateInputSchema,
  VariantReferenceRequestSchema,
  WarrantyRequestInputSchema,
} from './creation-schemas.js';

function variantBody(input: z.output<typeof VariantCreateInputSchema>) {
  const rest: Record<string, unknown> = { ...input };
  delete rest.productId;
  return Object.fromEntries(
    Object.entries(rest)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
  );
}

export class DigikalaVariantCreationResource {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

  getRequirements(productId: number) {
    return this.transport.request({
      method: 'GET',
      path: `variants/creation/${productId}`,
      input: { id: productId },
      inputSchema: IdInputSchema,
      outputSchema: CreationResponseSchema,
      serialize: () => ({}),
    });
  }

  getSizeTypes() {
    return this.transport.request({
      method: 'GET',
      path: 'variants/creation/size/types',
      input: {},
      inputSchema: z.object({}).strict(),
      outputSchema: CreationResponseSchema,
      serialize: () => ({}),
    });
  }

  getThemeValues(input: z.input<typeof ThemeValuesInputSchema>) {
    return this.transport.request({
      method: 'GET',
      path: `variants/creation/themes/${input.themeId}/theme-values`,
      input,
      inputSchema: ThemeValuesInputSchema,
      outputSchema: CreationResponseSchema,
      serialize: (input) => {
        const parsed: Record<string, unknown> = { ...input };
        delete parsed.themeId;
        return {
          params: Object.fromEntries(
            Object.entries(parsed)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [
                key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
                value,
              ]),
          ),
        };
      },
    });
  }

  create(input: z.input<typeof VariantCreateInputSchema>) {
    return this.transport.request({
      method: 'POST',
      path: `variants/creation/${input.productId}`,
      input,
      inputSchema: VariantCreateInputSchema,
      outputSchema: CreationResponseSchema,
      serialize: (parsed) => ({ data: variantBody(parsed) }),
    });
  }

  requestSize(input: z.input<typeof VariantReferenceRequestSchema>) {
    return this.requestReference('size', input);
  }
  requestColor(
    input: z.input<typeof VariantReferenceRequestSchema> & {
      productImageId?: string;
      hexCode?: string;
    },
  ) {
    return this.requestReference('color', input);
  }
  requestWarranty(input: z.input<typeof WarrantyRequestInputSchema>) {
    return this.transport.request({
      method: 'POST',
      path: 'variants/creation/warranty/request',
      input,
      inputSchema: WarrantyRequestInputSchema,
      outputSchema: CreationResponseSchema,
      serialize: (parsed) => ({
        data: Object.fromEntries(
          Object.entries(parsed)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [
              key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
              value,
            ]),
        ),
      }),
    });
  }

  private requestReference(
    kind: 'size' | 'color',
    input: z.input<typeof VariantReferenceRequestSchema> &
      Record<string, unknown>,
  ) {
    return this.transport.request({
      method: 'POST',
      path: `variants/creation/${kind}/request`,
      input,
      inputSchema: VariantReferenceRequestSchema.passthrough(),
      outputSchema: CreationResponseSchema,
      serialize: (parsed) => ({
        data: Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            value,
          ]),
        ),
      }),
    });
  }
}
