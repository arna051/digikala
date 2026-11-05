import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { IdInputSchema } from './schemas.js';
import {
  CreationResponseSchema,
  ThemeValuesInputSchema,
  VariantCreationRequirementsResponseSchema,
  VariantCreationResponseSchema,
  VariantCreateInputSchema,
  VariantReferenceRequestSchema,
  WarrantyRequestInputSchema,
  validateVariantCreationInput,
} from './creation-schemas.js';
import type { VariantCreationRequirements } from './creation-schemas.js';
import { DigikalaRequestValidationError } from '../validation/errors.js';

function snake(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function deepSnake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSnake);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [snake(key), deepSnake(item)]),
  );
}

function variantBody(input: z.output<typeof VariantCreateInputSchema>) {
  const rest: Record<string, unknown> = { ...input };
  delete rest.productId;
  return deepSnake(
    Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    ),
  );
}

export class DigikalaVariantCreationResource {
  readonly #requirements = new Map<number, VariantCreationRequirements>();

  constructor(private readonly transport: DigikalaAxiosTransport) {}

  async getRequirements(productId: number) {
    const response = await this.transport.request({
      method: 'GET',
      path: `variants/creation/${productId}`,
      input: { id: productId },
      inputSchema: IdInputSchema,
      outputSchema: VariantCreationRequirementsResponseSchema,
      serialize: () => ({}),
    });
    this.#requirements.set(productId, response.data);
    return response;
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

  async create(
    input: z.input<typeof VariantCreateInputSchema>,
    options: { requirements?: VariantCreationRequirements } = {},
  ) {
    let parsed: z.output<typeof VariantCreateInputSchema>;
    try {
      parsed = validateVariantCreationInput(
        input,
        options.requirements ?? this.#requirements.get(input.productId),
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new DigikalaRequestValidationError(error);
      }
      throw error;
    }
    return this.transport.request({
      method: 'POST',
      path: `variants/creation/${parsed.productId}`,
      input: parsed,
      inputSchema: VariantCreateInputSchema,
      outputSchema: VariantCreationResponseSchema,
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
