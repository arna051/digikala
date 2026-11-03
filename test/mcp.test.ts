import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createDigikalaMcpServer,
  type DigikalaMcpClient,
  type DigikalaMcpServerOptions,
} from '../src/mcp/index.js';
import type { CancelOrderInput } from '../src/resources/index.js';

function sdkClient(): DigikalaMcpClient {
  return {
    vendor: {
      id: 'vendor-1',
      name: 'Store',
      sellerCode: 'seller-123',
      authenticationStatus: 'authenticated',
      scopes: ['variant', 'product', 'order'],
      accessTokenExpiresAt: 'private-expiry',
      createdAt: 'private-created-at',
      updatedAt: 'private-updated-at',
    },
    variants: {
      list: vi.fn(() => Promise.resolve({ status: 'ok', data: { items: [] } })),
      get: vi.fn((id: number) =>
        Promise.resolve({ status: 'ok', data: { id } }),
      ),
      getStock: vi.fn(() => Promise.resolve({ status: 'ok', data: {} })),
      updateStock: vi.fn((input: { variantId: number; sellerStock: number }) =>
        Promise.resolve({ status: 'ok', data: input }),
      ),
      updatePrice: vi.fn(
        (input: {
          variantId: number;
          sellingPrice: number;
          creditIncreasePercentage: number;
        }) => Promise.resolve({ status: 'ok', data: input }),
      ),
      updateActivation: vi.fn(
        (input: { variantId: number; activation: boolean }) =>
          Promise.resolve({ status: 'ok', data: input }),
      ),
    },
    products: {
      list: vi.fn(() => Promise.resolve({ status: 'ok', data: { items: [] } })),
      getScore: vi.fn(() => Promise.resolve({ status: 'ok', data: {} })),
    },
    orders: {
      list: vi.fn(() => Promise.resolve({ status: 'ok', data: { items: [] } })),
      cancel: vi.fn((input: CancelOrderInput) =>
        Promise.resolve({ status: 'ok', data: input }),
      ),
    },
  };
}

async function connect(options: DigikalaMcpServerOptions) {
  const server = createDigikalaMcpServer(options);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe('Digikala MCP server', () => {
  it('publishes read tools only by default and returns credential-free structured data', async () => {
    const digikala = sdkClient();
    const connection = await connect({ client: digikala });
    try {
      const listed = await connection.client.listTools();
      expect(listed.tools.map(({ name }) => name)).toEqual([
        'digikala_variants_list',
        'digikala_variants_get',
        'digikala_variants_get_stock',
        'digikala_products_list',
        'digikala_products_get_score',
        'digikala_orders_list',
      ]);
      expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(
        true,
      );

      const result = await connection.client.callTool({
        name: 'digikala_variants_get',
        arguments: { id: 12 },
      });
      expect(result.structuredContent).toMatchObject({
        vendor: {
          id: 'vendor-1',
          name: 'Store',
          sellerCode: 'seller-123',
        },
        result: { status: 'ok', data: { id: 12 } },
      });
      expect(JSON.stringify(result)).not.toContain('private-');
      expect(JSON.stringify(result)).not.toContain('accessToken');

      vi.mocked(digikala.variants.get).mockResolvedValueOnce({
        status: 'ok',
        access_token: 'must-not-reach-the-model',
      });
      const redacted = await connection.client.callTool({
        name: 'digikala_variants_get',
        arguments: { id: 13 },
      });
      expect(JSON.stringify(redacted)).not.toContain(
        'must-not-reach-the-model',
      );
      expect(redacted.structuredContent).toMatchObject({
        result: { access_token: '[REDACTED]' },
      });
    } finally {
      await connection.close();
    }
  });

  it('rejects invalid tool arguments at the protocol boundary', async () => {
    const connection = await connect({ client: sdkClient() });
    try {
      const result = await connection.client.callTool({
        name: 'digikala_variants_get',
        arguments: { id: -1 },
      });
      expect(result.isError).toBe(true);
      const oversized = await connection.client.callTool({
        name: 'digikala_orders_list',
        arguments: { size: 101 },
      });
      expect(oversized.isError).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it('lists mutations only when enabled and authorizes every call', async () => {
    expect(() =>
      createDigikalaMcpServer({
        client: sdkClient(),
        allowMutations: true,
      } as never),
    ).toThrow(/authorizeMutation/);

    const digikala = sdkClient();
    const authorizeMutation = vi.fn(() => false);
    const connection = await connect({
      client: digikala,
      allowMutations: true,
      authorizeMutation,
    });
    try {
      const listed = await connection.client.listTools();
      const mutation = listed.tools.find(
        ({ name }) => name === 'digikala_variants_update_stock',
      );
      expect(mutation?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });

      const denied = await connection.client.callTool({
        name: 'digikala_variants_update_stock',
        arguments: { variantId: 7, sellerStock: 3 },
      });
      expect(denied.isError).toBe(true);
      expect(authorizeMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'digikala_variants_update_stock',
          input: { variantId: 7, sellerStock: 3 },
        }),
      );
      expect(digikala.variants.updateStock).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it('executes approved mutations and sanitizes SDK failures', async () => {
    const digikala = sdkClient();
    const onError = vi.fn();
    const connection = await connect({
      client: digikala,
      allowMutations: true,
      authorizeMutation: () => true,
      onError,
    });
    try {
      const approved = await connection.client.callTool({
        name: 'digikala_variants_update_activation',
        arguments: { variantId: 7, activation: false },
      });
      expect(approved.isError).not.toBe(true);
      expect(digikala.variants.updateActivation).toHaveBeenCalledWith({
        variantId: 7,
        activation: false,
      });

      vi.mocked(digikala.products.getScore).mockRejectedValueOnce(
        new Error('access-token-secret raw response'),
      );
      const failed = await connection.client.callTool({
        name: 'digikala_products_get_score',
        arguments: { id: 2 },
      });
      expect(failed.isError).toBe(true);
      expect(JSON.stringify(failed)).not.toContain('access-token-secret');
      expect(onError).toHaveBeenCalledOnce();
    } finally {
      await connection.close();
    }
  });
});
