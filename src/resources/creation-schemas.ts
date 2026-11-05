import { z } from 'zod';
import { apiResponseSchema, PositiveIdSchema } from '../validation/common.js';

const nonEmpty = z.string().trim().min(1);
const nonNegative = z.number().int().nonnegative();
const optionalDimension = z.number().nonnegative().optional();
const optionalPackageDimension = z.number().int().nonnegative().optional();
const JsonValueSchema: z.ZodType<unknown> = z.unknown();

export const CreationResponseSchema = apiResponseSchema(JsonValueSchema);

/** DKP is the shared product identifier used by every seller. */
export const DigikalaProductCodeSchema = PositiveIdSchema;
/** DKPC identifies one seller's sellable variant of a DKP. */
export const DigikalaVariantCodeSchema = PositiveIdSchema;

export const ProductModerationStatusSchema = z.enum([
  'draft',
  'waiting_for_confirm',
  'approved',
  'in_review',
  'removed',
  'duplicate',
]);

export const VariantThemeValueInputSchema = z
  .object({
    themeId: PositiveIdSchema,
    themeValueId: PositiveIdSchema,
  })
  .strict();

export const VariantSizeInputSchema = z
  .object({ id: nonEmpty, value: z.number().int().nonnegative() })
  .strict();

export const VariantPhotoInputSchema = z
  .object({ id: nonEmpty, isMain: z.boolean() })
  .strict();

export const VariantGoldPriceParametersSchema = z
  .object({
    goldWage: nonNegative.optional(),
    goldProfit: nonNegative.optional(),
    nonGoldPartsWage: nonNegative.optional(),
    nonGoldPartsProfit: nonNegative.optional(),
  })
  .strict();

const VariantDimensionRangeSchema = z
  .object({
    min: nonNegative.nullable().optional(),
    max: nonNegative.nullable().optional(),
  })
  .passthrough();

export const VariantCreationRequirementsSchema = z
  .object({
    warranty_options: z
      .array(
        z
          .object({ id: PositiveIdSchema, title: z.string().optional() })
          .passthrough(),
      )
      .optional(),
    lead_time_max: nonNegative.nullable().optional(),
    variant_theme: z.string().nullable().optional(),
    global_error_message: z.string().nullable().optional(),
    is_ship_by_seller_module_active: z.boolean().nullable().optional(),
    is_only_sbs: z.boolean().nullable().optional(),
    themes: z
      .array(
        z
          .object({
            id: PositiveIdSchema,
            label: z.string().optional(),
            themeType: z.string().optional(),
          })
          .passthrough(),
      )
      .max(2)
      .optional(),
    dimension_config: z
      .object({
        length: VariantDimensionRangeSchema.nullable().optional(),
        width: VariantDimensionRangeSchema.nullable().optional(),
        height: VariantDimensionRangeSchema.nullable().optional(),
        weight: VariantDimensionRangeSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    size_guide: z
      .object({
        config: z.array(z.object({}).passthrough()).nullable().optional(),
        is_required_on_create: z.boolean().nullable().optional(),
        is_required_on_edit: z.boolean().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    variant_photo_upload: z
      .object({
        can_upload: z.union([z.string(), z.boolean()]).nullable().optional(),
        main_image_mandatory: z.boolean().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const VariantCreationRequirementsResponseSchema = apiResponseSchema(
  VariantCreationRequirementsSchema,
);

export const VariantCreationResultSchema = z
  .object({
    id: DigikalaVariantCodeSchema,
    is_active: z.boolean().nullable().optional(),
    marketplace_seller_stock: nonNegative.nullable().optional(),
    supplier_code: z.string().nullable().optional(),
    price: nonNegative.nullable().optional(),
    warranty_id: PositiveIdSchema.nullable().optional(),
    theme_values: z.array(z.object({}).passthrough()).nullable().optional(),
    warnings: z
      .array(
        z
          .object({
            code: z.string().nullable().optional(),
            message: z.string().nullable().optional(),
            cta: z.object({}).passthrough().nullable().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();

export const VariantCreationResponseSchema = apiResponseSchema(
  VariantCreationResultSchema,
);

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
    fakeReasons: z.array(PositiveIdSchema).optional(),
    generalMefaId: nonEmpty.optional(),
    exclusiveMefaId: nonEmpty.optional(),
    packageWidth: optionalPackageDimension,
    packageHeight: optionalPackageDimension,
    packageLength: optionalPackageDimension,
    packageWeight: optionalPackageDimension,
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
    packageWidth: optionalPackageDimension,
    packageHeight: optionalPackageDimension,
    packageLength: optionalPackageDimension,
    packageWeight: optionalPackageDimension,
    goldPriceParameters: VariantGoldPriceParametersSchema.optional(),
    sizes: z.array(VariantSizeInputSchema).optional(),
    photosDetail: z.array(VariantPhotoInputSchema).optional(),
    // Service Hub currently permits two themes only for fashion categories.
    themeValues: z.array(VariantThemeValueInputSchema).max(2).optional(),
  })
  .strict();

/** Validate category-dependent rules returned by `getRequirements()`. */
export function validateVariantCreationInput(
  input: unknown,
  requirements?: VariantCreationRequirements,
) {
  const parsed = VariantCreateInputSchema.parse(input);
  if (!requirements) return parsed;

  const issues: Array<{ path: PropertyKey[]; message: string }> = [];
  if (
    requirements.lead_time_max != null &&
    parsed.leadTime != null &&
    parsed.leadTime > requirements.lead_time_max
  ) {
    issues.push({
      path: ['leadTime'],
      message: `Lead time must not exceed ${requirements.lead_time_max}`,
    });
  }

  const dimensions = [
    ['packageLength', requirements.dimension_config?.length],
    ['packageWidth', requirements.dimension_config?.width],
    ['packageHeight', requirements.dimension_config?.height],
    ['packageWeight', requirements.dimension_config?.weight],
  ] as const;
  for (const [field, range] of dimensions) {
    const value = parsed[field];
    if (value == null || !range) continue;
    if (range.min != null && value < range.min) {
      issues.push({
        path: [field],
        message: `${field} must be at least ${range.min}`,
      });
    }
    if (range.max != null && value > range.max) {
      issues.push({
        path: [field],
        message: `${field} must not exceed ${range.max}`,
      });
    }
  }

  if (requirements.size_guide?.is_required_on_create && !parsed.sizes?.length) {
    issues.push({ path: ['sizes'], message: 'Size guide values are required' });
  }
  if (
    requirements.variant_photo_upload?.main_image_mandatory &&
    !parsed.photosDetail?.some((photo) => photo.isMain)
  ) {
    issues.push({
      path: ['photosDetail'],
      message: 'A main variant image is required',
    });
  }

  const allowedThemeIds = new Set(
    requirements.themes?.map((theme) => theme.id) ?? [],
  );
  const submittedThemeIds =
    parsed.themeValues?.map((theme) => theme.themeId) ?? [];
  if (new Set(submittedThemeIds).size !== submittedThemeIds.length) {
    issues.push({
      path: ['themeValues'],
      message: 'Each theme may be selected only once',
    });
  }
  for (const [index, themeId] of submittedThemeIds.entries()) {
    if (allowedThemeIds.size > 0 && !allowedThemeIds.has(themeId)) {
      issues.push({
        path: ['themeValues', index, 'themeId'],
        message: 'Theme is not available for this product',
      });
    }
  }

  if (issues.length > 0) {
    throw new z.ZodError(issues.map((issue) => ({ code: 'custom', ...issue })));
  }
  return parsed;
}

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
    moderationStatus: ProductModerationStatusSchema.optional(),
    duplicateProductId: PositiveIdSchema.optional(),
    completedSteps: z.array(nonEmpty).default([]),
    pendingFields: z.array(nonEmpty).default([]),
    lastError: nonEmpty.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type CreationWorkflowState = z.infer<typeof CreationWorkflowStateSchema>;
export type ProductSearchInput = z.input<typeof ProductSearchInputSchema>;
export type ProductSuggestionInput = z.input<
  typeof ProductSuggestionInputSchema
>;
export type ProductDetailsInput = z.input<typeof ProductDetailsInputSchema>;
export type ProductTitleInput = z.input<typeof ProductTitleInputSchema>;
export type ProductAttributesInput = z.input<
  typeof ProductAttributesInputSchema
>;
export type ProductImageAiInput = z.input<typeof ProductImageAiInputSchema>;
export type ProductSaveInput = z.input<typeof ProductSaveInputSchema>;
export type BrandSearchInput = z.input<typeof BrandSearchInputSchema>;
export type BrandRequestInput = z.input<typeof BrandRequestInputSchema>;
export type VariantCreateInput = z.input<typeof VariantCreateInputSchema>;
export type VariantReferenceRequest = z.input<
  typeof VariantReferenceRequestSchema
>;
export type ThemeValuesInput = z.input<typeof ThemeValuesInputSchema>;
export type DraftProductsInput = z.input<typeof DraftProductsInputSchema>;
export type WarrantyRequestInput = z.input<typeof WarrantyRequestInputSchema>;
export type UploadImageInput = z.input<typeof UploadImageInputSchema>;
export type ProductModerationStatus = z.infer<
  typeof ProductModerationStatusSchema
>;
export type VariantCreationRequirements = z.output<
  typeof VariantCreationRequirementsSchema
>;
export type VariantCreationResult = z.output<
  typeof VariantCreationResultSchema
>;
