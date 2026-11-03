import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult, JSONValue } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import type { VendorSummary } from '../auth/index.js';
import { CancelOrderInputSchema, IdInputSchema } from '../resources/schemas.js';
import type {
  CancelOrderInput,
  OrdersListInput,
  ProductsListInput,
  VariantsListInput,
} from '../resources/types.js';
import { Schemas } from '../validation/index.js';

export interface DigikalaMcpClient {
  readonly vendor: VendorSummary;
  readonly variants: {
    list: (input?: VariantsListInput) => Promise<unknown>;
    get: (variantId: number) => Promise<unknown>;
    getStock: (variantId: number) => Promise<unknown>;
    updateStock: (input: {
      variantId: number;
      sellerStock: number;
    }) => Promise<unknown>;
    updatePrice: (input: {
      variantId: number;
      sellingPrice: number;
      creditIncreasePercentage: number;
    }) => Promise<unknown>;
    updateActivation: (input: {
      variantId: number;
      activation: boolean;
    }) => Promise<unknown>;
  };
  readonly products: {
    list: (input?: ProductsListInput) => Promise<unknown>;
    getScore: (productId: number) => Promise<unknown>;
  };
  readonly orders: {
    list: (input?: OrdersListInput) => Promise<unknown>;
    cancel: (input: CancelOrderInput) => Promise<unknown>;
  };
}

export type DigikalaMcpMutationTool =
  | 'digikala_variants_update_stock'
  | 'digikala_variants_update_price'
  | 'digikala_variants_update_activation'
  | 'digikala_orders_cancel';

export interface DigikalaMcpMutationContext {
  tool: DigikalaMcpMutationTool;
  input: Record<string, unknown>;
  vendor: VendorSummary;
}

interface CommonOptions {
  client: DigikalaMcpClient;
  name?: string;
  version?: string;
  onError?: (error: unknown, tool: string) => void | Promise<void>;
}
type ReadOnlyOptions = CommonOptions & {
  allowMutations?: false;
  authorizeMutation?: never;
};
type MutableOptions = CommonOptions & {
  allowMutations: true;
  authorizeMutation: (
    context: DigikalaMcpMutationContext,
  ) => boolean | Promise<boolean>;
};
export type DigikalaMcpServerOptions = ReadOnlyOptions | MutableOptions;

const TOOL_ERROR_TEXT = 'The Digikala operation failed.';
const MUTATION_DENIED_TEXT = 'The Digikala mutation was not authorized.';
const McpPageSizeSchema = z.number().int().positive().max(100).default(50);
const McpVariantPageSizeSchema = z
  .number()
  .int()
  .positive()
  .max(50)
  .default(50);
const McpVariantsListSchema = Schemas.Variants.list.extend({
  size: McpVariantPageSizeSchema,
});
const McpProductsListSchema = Schemas.Products.list.extend({
  size: McpPageSizeSchema,
});
const McpOrdersListSchema = Schemas.Orders.list.extend({
  size: McpPageSizeSchema,
});

export function createDigikalaMcpServer(
  options: DigikalaMcpServerOptions,
): McpServer {
  if (options.allowMutations && !options.authorizeMutation) {
    throw new TypeError(
      'authorizeMutation is required when MCP mutations are enabled',
    );
  }
  const server = new McpServer({
    name: options.name ?? 'digikala-seller',
    version: options.version ?? '0.1.0',
  });
  registerReadTools(server, options);
  if (options.allowMutations) registerMutationTools(server, options);
  return server;
}

export async function connectDigikalaMcpStdio(
  options: DigikalaMcpServerOptions,
): Promise<McpServer> {
  const server = createDigikalaMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}

function registerReadTools(
  server: McpServer,
  options: DigikalaMcpServerOptions,
): void {
  server.registerTool(
    'digikala_variants_list',
    {
      title: 'List Digikala variants',
      description: 'List variants belonging to the configured seller.',
      inputSchema: McpVariantsListSchema,
      annotations: readAnnotations(),
    },
    (input) =>
      runTool(options, 'digikala_variants_list', () =>
        options.client.variants.list(input),
      ),
  );
  registerIdReadTool(
    server,
    options,
    'digikala_variants_get',
    'Get Digikala variant',
    'Get one seller variant by variant ID.',
    (id) => options.client.variants.get(id),
  );
  registerIdReadTool(
    server,
    options,
    'digikala_variants_get_stock',
    'Get Digikala variant stock',
    'Read seller and warehouse stock for one variant.',
    (id) => options.client.variants.getStock(id),
  );
  server.registerTool(
    'digikala_products_list',
    {
      title: 'List Digikala seller products',
      description: 'List products belonging to the configured seller.',
      inputSchema: McpProductsListSchema,
      annotations: readAnnotations(),
    },
    (input) =>
      runTool(options, 'digikala_products_list', () =>
        options.client.products.list(input),
      ),
  );
  registerIdReadTool(
    server,
    options,
    'digikala_products_get_score',
    'Get Digikala product content score',
    'Read the content score for one product.',
    (id) => options.client.products.getScore(id),
  );
  server.registerTool(
    'digikala_orders_list',
    {
      title: 'List Digikala orders',
      description: 'List active order items for the configured seller.',
      inputSchema: McpOrdersListSchema,
      annotations: readAnnotations(),
    },
    (input) =>
      runTool(options, 'digikala_orders_list', () =>
        options.client.orders.list(input),
      ),
  );
}

function registerIdReadTool(
  server: McpServer,
  options: DigikalaMcpServerOptions,
  tool: string,
  title: string,
  description: string,
  execute: (id: number) => Promise<unknown>,
): void {
  server.registerTool(
    tool,
    {
      title,
      description,
      inputSchema: IdInputSchema,
      annotations: readAnnotations(),
    },
    ({ id }) => runTool(options, tool, () => execute(id)),
  );
}

function readAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}

function registerMutationTools(
  server: McpServer,
  options: MutableOptions,
): void {
  server.registerTool(
    'digikala_variants_update_stock',
    {
      title: 'Update Digikala variant stock',
      description: 'Set seller stock for one variant.',
      inputSchema: Schemas.Variants.updateStock,
      annotations: mutationAnnotations(true),
    },
    (input) =>
      runMutation(options, 'digikala_variants_update_stock', input, () =>
        options.client.variants.updateStock(input),
      ),
  );
  server.registerTool(
    'digikala_variants_update_price',
    {
      title: 'Update Digikala variant price',
      description:
        'Set selling price and credit increase percentage for one variant.',
      inputSchema: Schemas.Variants.updatePrice,
      annotations: mutationAnnotations(true),
    },
    (input) =>
      runMutation(options, 'digikala_variants_update_price', input, () =>
        options.client.variants.updatePrice(input),
      ),
  );
  server.registerTool(
    'digikala_variants_update_activation',
    {
      title: 'Update Digikala variant activation',
      description: 'Activate or deactivate one seller variant.',
      inputSchema: Schemas.Variants.updateActivation,
      annotations: mutationAnnotations(true),
    },
    (input) =>
      runMutation(options, 'digikala_variants_update_activation', input, () =>
        options.client.variants.updateActivation(input),
      ),
  );
  server.registerTool(
    'digikala_orders_cancel',
    {
      title: 'Cancel Digikala order item',
      description: 'Cancel all or part of a seller order item.',
      inputSchema: CancelOrderInputSchema,
      annotations: mutationAnnotations(false),
    },
    (input) =>
      runMutation(options, 'digikala_orders_cancel', input, () =>
        options.client.orders.cancel(input),
      ),
  );
}

function mutationAnnotations(idempotentHint: boolean) {
  return {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint,
    openWorldHint: true,
  };
}

async function runMutation(
  options: MutableOptions,
  tool: DigikalaMcpMutationTool,
  input: Record<string, unknown>,
  execute: () => Promise<unknown>,
): Promise<CallToolResult> {
  const authorized = await safelyAuthorize(options, {
    tool,
    input,
    vendor: options.client.vendor,
  });
  if (!authorized) return toolError(MUTATION_DENIED_TEXT);
  return runTool(options, tool, execute);
}

async function safelyAuthorize(
  options: MutableOptions,
  context: DigikalaMcpMutationContext,
): Promise<boolean> {
  try {
    return await options.authorizeMutation(context);
  } catch {
    return false;
  }
}

async function runTool(
  options: DigikalaMcpServerOptions,
  tool: string,
  execute: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const output = {
      vendor: safeVendor(options.client.vendor),
      result: toSafeJsonValue(await execute()),
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    await safelyReportError(options.onError, error, tool);
    return toolError(TOOL_ERROR_TEXT);
  }
}

function toSafeJsonValue(value: unknown): JSONValue {
  const serialized = JSON.stringify(value, (key, nested: unknown) =>
    isSensitiveKey(key) ? '[REDACTED]' : nested,
  );
  if (serialized === undefined) return null;
  const parsed = JSON.parse(serialized) as unknown;
  return parsed as JSONValue;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    normalized.endsWith('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized === 'privatekey' ||
    normalized === 'publickey' ||
    normalized === 'authorization' ||
    normalized === 'cookie'
  );
}

function safeVendor(vendor: VendorSummary) {
  return {
    id: vendor.id,
    name: vendor.name,
    sellerCode: vendor.sellerCode,
    authenticationStatus: vendor.authenticationStatus,
    scopes: [...vendor.scopes],
  };
}

async function safelyReportError(
  callback: CommonOptions['onError'],
  error: unknown,
  tool: string,
): Promise<void> {
  try {
    await callback?.(error, tool);
  } catch {
    // Observability must not expose or replace the sanitized MCP result.
  }
}

function toolError(text: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text' as const, text }],
  };
}

export type {
  CancelOrderInput,
  OrdersListInput,
  ProductsListInput,
  VariantsListInput,
} from '../resources/types.js';
