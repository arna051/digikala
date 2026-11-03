import { z } from 'zod';
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
import { IdInputSchema } from './schemas.js';
import {
  BrandRequestInputSchema,
  BrandSearchInputSchema,
  CreationResponseSchema,
  DraftProductsInputSchema,
  ProductAttributesInputSchema,
  ProductDetailsInputSchema,
  ProductImageAiInputSchema,
  ProductSaveInputSchema,
  ProductSearchInputSchema,
  ProductSuggestionInputSchema,
  ProductTitleInputSchema,
  UploadImageInputSchema,
} from './creation-schemas.js';

const snake = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const body = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [snake(key), item]),
  );
const query = (value: Record<string, unknown>, search = false) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [
        search ? `search[${snake(key)}]` : snake(key),
        Array.isArray(item) ? item.join(',') : item,
      ]),
  );

export class DigikalaProductCreationResource {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

  search(input: z.input<typeof ProductSearchInputSchema>) {
    return this.get(
      'product-creation/search/v2',
      input,
      ProductSearchInputSchema,
      (parsed) => ({ params: query(parsed, true) }),
    );
  }
  suggestions(input: z.input<typeof ProductSuggestionInputSchema> = {}) {
    return this.get(
      'product-creation/search/suggestion/v2',
      input,
      ProductSuggestionInputSchema,
      (parsed) => ({ params: query(parsed, true) }),
    );
  }
  getSellability(productId: number) {
    return this.get(
      `product-creation/be-seller/${productId}`,
      { id: productId },
      IdInputSchema,
      () => ({}),
    );
  }
  searchCategories(keyword: string | number) {
    const value = String(keyword).trim();
    return this.get(
      `product-creation/search/category/v2/${encodeURIComponent(value)}`,
      { keyword: value },
      z.object({ keyword: z.string().min(1) }).strict(),
      () => ({}),
    );
  }
  validateCategory(categoryId: number) {
    return this.get(
      `product-creation/category/${categoryId}/validation`,
      { id: categoryId },
      IdInputSchema,
      () => ({}),
    );
  }
  validateDetails(input: z.input<typeof ProductDetailsInputSchema>) {
    return this.post(
      'product-creation/product/detail/validation',
      input,
      ProductDetailsInputSchema,
    );
  }
  getDraft(draftProductId: number) {
    return this.get(
      `product-creation/draft-product/${draftProductId}`,
      { id: draftProductId },
      IdInputSchema,
      () => ({}),
    );
  }
  getDraftCount() {
    return this.get(
      'product-creation/draft-product/count',
      {},
      z.object({}).strict(),
      () => ({}),
    );
  }
  listDrafts(input: z.input<typeof DraftProductsInputSchema> = {}) {
    return this.get(
      'draft-products/seller',
      input,
      DraftProductsInputSchema,
      (parsed) => ({ params: query(parsed, true) }),
    );
  }
  getAutoTitle(draftProductId: number) {
    return this.get(
      `product-creation/${draftProductId}/auto-title`,
      { id: draftProductId },
      IdInputSchema,
      () => ({}),
    );
  }
  saveTitle(input: z.input<typeof ProductTitleInputSchema>) {
    return this.post(
      'product-creation/auto-title/save',
      input,
      ProductTitleInputSchema,
    );
  }
  getAttributes(categoryId: number) {
    return this.get(
      `product-creation/attributes/${categoryId}`,
      { id: categoryId },
      IdInputSchema,
      () => ({}),
    );
  }
  validateAttributes(input: z.input<typeof ProductAttributesInputSchema>) {
    return this.post(
      'product-creation/attributes',
      input,
      ProductAttributesInputSchema,
    );
  }
  validateImage(input: z.input<typeof ProductImageAiInputSchema>) {
    return this.post(
      'product-creation/images/ai',
      input,
      ProductImageAiInputSchema,
    );
  }
  save(input: z.input<typeof ProductSaveInputSchema>) {
    return this.post('product-creation/save', input, ProductSaveInputSchema);
  }
  assign(productId: number) {
    return this.transport.request({
      method: 'POST',
      path: 'product-creation/assign',
      input: { id: productId },
      inputSchema: IdInputSchema,
      outputSchema: CreationResponseSchema,
      serialize: ({ id }) => ({ data: { productId: id } }),
    });
  }
  searchBrands(input: z.input<typeof BrandSearchInputSchema> = {}) {
    return this.get(
      'product-creation/brand',
      input,
      BrandSearchInputSchema,
      (parsed) => ({ params: query(parsed) }),
    );
  }
  requestBrand(input: z.input<typeof BrandRequestInputSchema>) {
    return this.post(
      'product-creation/brand/request',
      input,
      BrandRequestInputSchema,
    );
  }
  uploadImage(
    file: Blob,
    purpose: 'product' | 'request' | 'brand_logo' = 'product',
  ) {
    const path =
      purpose === 'product'
        ? 'product-creation/images/upload'
        : purpose === 'request'
          ? 'product-creation/images/requests/upload'
          : 'product-creation/images/requests/brand-logo/upload';
    return this.transport.request({
      method: 'POST',
      path,
      input: { file },
      inputSchema: UploadImageInputSchema,
      outputSchema: CreationResponseSchema,
      serialize: ({ file: upload }) => {
        const data = new FormData();
        data.append('file', upload);
        return { data };
      },
    });
  }

  private get<T extends z.ZodType>(
    path: string,
    input: z.input<T>,
    inputSchema: T,
    serialize: (input: z.output<T>) => { params?: Record<string, unknown> },
  ) {
    return this.transport.request({
      method: 'GET',
      path,
      input,
      inputSchema,
      outputSchema: CreationResponseSchema,
      serialize,
    });
  }
  private post<T extends z.ZodType>(
    path: string,
    input: z.input<T>,
    inputSchema: T,
  ) {
    return this.transport.request({
      method: 'POST',
      path,
      input,
      inputSchema,
      outputSchema: CreationResponseSchema,
      serialize: (parsed) => ({
        data: body(parsed as Record<string, unknown>),
      }),
    });
  }
}
