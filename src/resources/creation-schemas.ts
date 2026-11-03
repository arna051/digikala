import { z } from 'zod';
import { apiResponseSchema, PositiveIdSchema } from '../validation/common.js';

const nonEmpty = z.string().trim().min(1);
const nonNegative = z.number().int().nonnegative();
const optionalDimension = z.number().nonnegative().optional();
const JsonValueSchema: z.ZodType<unknown> = z.unknown();

export const CreationResponseSchema = apiResponseSchema(JsonValueSchema);

export const ProductSearchInputSchema = z
  .object({
    keyword: nonEmpty,
    categories: z.array(PositiveIdSchema).optional(),
    brands: z.array(PositiveIdSchema).optional(),
    types: z.array(PositiveIdSchema).optional(),
    colorPalettes: z.array(PositiveIdSchema).optional(),
    statuses: z
      .array(z.enum(['marketable', 'coming_soon', 'stop_production']))
      .optional(),
    fake: z.boolean().optional(),
  })
  .strict();

export const ProductSuggestionInputSchema = z
  .object({ keyword: nonEmpty.optional() })
  .strict();

export const ProductDetailsInputSchema = z
  .object({
    categoryId: PositiveIdSchema,
    divisionId: PositiveIdSchema.optional(),
    model: nonEmpty.optional(),
    brandId: PositiveIdSchema,
    referenceBrandId: PositiveIdSchema.optional(),
    productTypeIds: z.array(PositiveIdSchema).optional(),
    colorId: PositiveIdSchema.optional(),
    isIranian: z.boolean(),
    productClasses: z.array(z.union([z.string(), z.number()])).optional(),
    fake: z.boolean().optional(),
    fakeReasons: z.array(nonEmpty).optional(),
    generalMefaId: PositiveIdSchema.optional(),
    exclusiveMefaId: nonEmpty.optional(),
    packageWidth: optionalDimension,
    packageHeight: optionalDimension,
    packageLength: optionalDimension,
    packageWeight: optionalDimension,
    description: nonEmpty.optional(),
    disadvantages: z.array(nonEmpty).optional(),
    advantages: z.array(nonEmpty).optional(),
    draftProductId: PositiveIdSchema.optional(),
  })
  .strict();

export const ProductTitleInputSchema = z
  .object({
    draftProductId: PositiveIdSchema,
    titleFa: nonEmpty,
    titleEn: nonEmpty.optional(),
    description: nonEmpty.optional(),
    advantages: z.array(nonEmpty).optional(),
    disadvantages: z.array(nonEmpty).optional(),
  })
  .strict();

export const ProductAttributesInputSchema = z
  .object({
    draftProductId: PositiveIdSchema,
    length: optionalDimension,
    width: optionalDimension,
    height: optionalDimension,
    weight: optionalDimension,
    attributes: z
      .array(z.array(z.record(z.string(), JsonValueSchema)))
      .optional(),
  })
  .strict();

export const ProductImageAiInputSchema = z
  .object({ imageId: nonEmpty, isMain: z.boolean() })
  .strict();

export const ProductSaveInputSchema = z
  .object({
    categoryId: PositiveIdSchema,
    draftProductId: PositiveIdSchema,
    useTempImages: z.boolean().optional(),
    onlyB2b: z.boolean().optional(),
    photosDetail: z.array(z.record(z.string(), JsonValueSchema)).optional(),
  })
  .strict();

export const BrandSearchInputSchema = z
  .object({
    titleFa: nonEmpty.optional(),
    titleEn: nonEmpty.optional(),
    page: z.number().int().positive().default(1),
    size: z.number().int().positive().max(100).default(50),
  })
  .strict();

export const BrandRequestInputSchema = z
  .object({
    brandOrigin: nonEmpty,
    description: nonEmpty,
    logoId: nonEmpty,
    nameEn: nonEmpty,
    nameFa: nonEmpty,
    iranianRegistrationUrl: z.url().optional(),
    purpose: nonEmpty.optional(),
    categoryId: PositiveIdSchema.optional(),
  })
  .strict();

export const VariantCreateInputSchema = z
  .object({
    productId: PositiveIdSchema,
    isActive: z.boolean(),
    orderLimit: z.number().int().min(2),
    marketplaceSellerStock: nonNegative,
    supplierCode: nonEmpty.optional(),
    price: z.number().int().nonnegative().optional(),
    warrantyId: PositiveIdSchema,
    site: nonEmpty,
    shippingType: nonEmpty,
    leadTime: nonNegative.optional(),
    fbsLeadTime: nonNegative.optional(),
    threeHourDelivery: z.boolean().optional(),
    colorId: PositiveIdSchema.optional(),
    sizeId: PositiveIdSchema.optional(),
    packageWidth: optionalDimension,
    packageHeight: optionalDimension,
    packageLength: optionalDimension,
    packageWeight: optionalDimension,
    goldPriceParameters: z.record(z.string(), JsonValueSchema).optional(),
    sizes: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    photosDetail: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    themeValues: z.array(z.record(z.string(), JsonValueSchema)).optional(),
  })
  .strict();

export const VariantReferenceRequestSchema = z
  .object({
    productId: PositiveIdSchema,
    title: nonEmpty,
    themeId: PositiveIdSchema.optional(),
  })
  .strict();

export const ThemeValuesInputSchema = z
  .object({
    themeId: PositiveIdSchema,
    page: z.number().int().positive().default(1),
    size: z.number().int().positive().max(100).default(50),
    order: z.enum(['asc', 'desc']).default('asc'),
    productId: PositiveIdSchema.optional(),
    categoryId: PositiveIdSchema.optional(),
    brandId: PositiveIdSchema.optional(),
  })
  .strict();

export const DraftProductsInputSchema = z
  .object({
    brandIds: z.array(PositiveIdSchema).optional(),
    categoryIds: z.array(PositiveIdSchema).optional(),
    nearExpiration: z.boolean().optional(),
  })
  .strict();

export const WarrantyRequestInputSchema = z
  .object({
    productId: PositiveIdSchema.optional(),
    warrantyTitle: nonEmpty,
    warrantyPeriod: z.number().int().positive(),
    warrantyImageId1: nonEmpty,
    warrantyImageId2: nonEmpty.optional(),
    hasInsurance: z.boolean(),
    insuranceTitle: nonEmpty.optional(),
    insurancePeriod: z.number().int().positive().optional(),
    insuranceImageId1: nonEmpty.optional(),
    insuranceImageId2: nonEmpty.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.hasInsurance &&
      (!value.insuranceTitle ||
        !value.insurancePeriod ||
        !value.insuranceImageId1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hasInsurance'],
        message:
          'Insurance title, period, and first image are required when insurance is enabled',
      });
    }
  });

export const UploadImageInputSchema = z
  .object({ file: z.instanceof(Blob) })
  .strict();

export const CreationWorkflowStateSchema = z
  .object({
    id: z.string().uuid(),
    vendorId: nonEmpty,
    mode: z.enum(['existing_product', 'new_product']),
    status: z.enum([
      'searching',
      'collecting_details',
      'collecting_attributes',
      'collecting_images',
      'pending_moderation',
      'ready_for_variant',
      'completed',
      'failed',
    ]),
    productId: PositiveIdSchema.optional(),
    draftProductId: PositiveIdSchema.optional(),
    variantId: PositiveIdSchema.optional(),
    completedSteps: z.array(nonEmpty).default([]),
    pendingFields: z.array(nonEmpty).default([]),
    lastError: nonEmpty.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type CreationWorkflowState = z.infer<typeof CreationWorkflowStateSchema>;
