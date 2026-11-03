import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'browser/index': 'src/browser/index.ts',
    'node/index': 'src/node/index.ts',
    'auth/index': 'src/auth/index.ts',
    'account-manager/index': 'src/account-manager/index.ts',
    'webhooks/index': 'src/webhooks/index.ts',
    'webhooks/express': 'src/webhooks/express.ts',
    'mcp/index': 'src/mcp/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  platform: 'neutral',
  external: ['@huggingface/transformers', 'better-sqlite3', 'sqlite-vec'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
