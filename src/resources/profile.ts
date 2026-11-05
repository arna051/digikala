import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { apiResponseSchema } from '../validation/common.js';

const optionalText = z.string().nullable().optional();

export const ProfileSchema = z
  .object({
    seller_id: z.number().int().positive(),
    seller_name: z.string().optional(),
    secondary_business_name: optionalText,
    seller_rating: z.number().optional(),
    wallet_credit: z.number().int().optional(),
    is_private: z.boolean().optional(),
    registration_status: z.string().optional(),
    first_name: optionalText,
    last_name: optionalText,
    email: optionalText,
    phone: z.union([z.string(), z.number()]).nullable().optional(),
    national_id: optionalText,
  })
  .passthrough();

export const ProfileResponseSchema = apiResponseSchema(ProfileSchema);
export const ProfileSectionResponseSchema = apiResponseSchema(
  z.object({}).passthrough(),
);
export const ProfileListSectionResponseSchema = apiResponseSchema(
  z.union([z.array(z.object({}).passthrough()), z.object({}).passthrough()]),
);

export const ProfileBusinessUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    mobilePhone: z.string().trim().min(1).optional(),
    email: z.email().optional(),
    companyName: z.string().trim().min(1).optional(),
    companyType: z.string().trim().min(1).optional(),
    companyRegistrationNumber: z.string().trim().min(1).optional(),
    companyNationalIdNumber: z.string().trim().min(1).optional(),
    companyEconomicNumber: z.string().trim().min(1).optional(),
    companyAuthorizedRepresentative: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field is required',
  );

export class DigikalaProfileResource {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

  get(input: { mini?: boolean } = {}) {
    return this.transport.request({
      method: 'GET',
      path: 'profile',
      input,
      inputSchema: z.object({ mini: z.boolean().optional() }).strict(),
      outputSchema: ProfileResponseSchema,
      serialize: ({ mini }) => ({
        params: mini === undefined ? undefined : { mini: String(mini) },
      }),
    });
  }

  business() {
    return this.section('profile/business');
  }

  updateBusiness(input: z.input<typeof ProfileBusinessUpdateSchema>) {
    return this.transport.request({
      method: 'PATCH',
      path: 'profile/business',
      input,
      inputSchema: ProfileBusinessUpdateSchema,
      outputSchema: ProfileSectionResponseSchema,
      serialize: (value) => ({
        data: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            item,
          ]),
        ),
      }),
    });
  }

  store() {
    return this.section('profile/store');
  }
  addresses() {
    return this.listSection('profile/address');
  }
  warehouses() {
    return this.listSection('profile/warehouse');
  }
  documents() {
    return this.listSection('profile/document');
  }
  training() {
    return this.section('profile/training');
  }
  performance() {
    return this.section('profile/performance');
  }

  private section(path: string) {
    return this.transport.request({
      method: 'GET',
      path,
      input: {},
      inputSchema: z.object({}).strict(),
      outputSchema: ProfileSectionResponseSchema,
      serialize: () => ({}),
    });
  }

  private listSection(path: string) {
    return this.transport.request({
      method: 'GET',
      path,
      input: {},
      inputSchema: z.object({}).strict(),
      outputSchema: ProfileListSectionResponseSchema,
      serialize: () => ({}),
    });
  }
}
