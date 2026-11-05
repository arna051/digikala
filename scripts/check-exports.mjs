import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const root = await import('digikala');
const browser = await import('digikala/browser');
const node = await import('digikala/node');
const schemas = await import('digikala/schemas');
const auth = await import('digikala/auth');
const nodeAuth = await import('digikala/auth/node');
const accountManager = await import('digikala/account-manager');
const webhooks = await import('digikala/webhooks');
const expressWebhooks = await import('digikala/webhooks/express');
const mcp = await import('digikala/mcp');

assert.equal(root.default, root.Digikala);
assert.equal(typeof root.Schemas.Variants.list.safeParse, 'function');
assert.equal(typeof root.VariantCreateInputSchema.safeParse, 'function');
assert.equal(typeof schemas.ProductDetailsInputSchema.safeParse, 'function');
assert.equal(typeof schemas.VariantCreateInputSchema.safeParse, 'function');
assert.equal(browser.runtime, 'browser');
assert.equal(node.runtime, 'node');
assert.equal(typeof node.InMemoryDigikalaAccountStore, 'function');
assert.equal(typeof node.DigikalaAxiosTransport, 'function');
assert.equal(typeof node.DigikalaVariantsResource, 'function');
assert.equal(typeof node.DigikalaProductsResource, 'function');
assert.equal(typeof node.DigikalaOrdersResource, 'function');
assert.equal(typeof node.DigikalaSellerApi, 'function');
assert.equal(node.DIGIKALA_GENERATED_OPERATION_COUNT, 277);
assert.equal(typeof node.isAccessTokenExpiring, 'function');
assert.equal(typeof node.DigikalaTokenRefreshRejectedError, 'function');
assert.equal(typeof node.DigikalaCacheManager, 'function');
assert.equal(typeof node.SqliteDigikalaCacheStore, 'function');
assert.equal(typeof node.TransformersJsEmbeddingProvider, 'function');
assert.equal(typeof node.createDigikalaAccountManager, 'function');
assert.equal(typeof accountManager.createDigikalaAccountManager, 'function');
assert.equal(root.SqliteDigikalaCacheStore, undefined);
assert.equal(browser.SqliteDigikalaCacheStore, undefined);
assert.equal(typeof auth.DigikalaAuth.createAccount, 'function');
assert.equal(typeof auth.DigikalaAuth.refreshAuthentication, 'function');
assert.equal(nodeAuth.DigikalaAuth, auth.DigikalaAuth);
assert.equal(typeof webhooks, 'object');
assert.equal(typeof expressWebhooks, 'object');
assert.equal(typeof webhooks.createDigikalaWebhookHandler, 'function');
assert.equal(typeof expressWebhooks.createExpressWebhookHandler, 'function');
assert.equal(typeof mcp, 'object');
assert.equal(typeof mcp.createDigikalaMcpServer, 'function');
assert.equal(typeof mcp.connectDigikalaMcpStdio, 'function');

const cjsRoot = require('digikala');
const cjsBrowser = require('digikala/browser');
const cjsNode = require('digikala/node');
const cjsSchemas = require('digikala/schemas');
const cjsAccountManager = require('digikala/account-manager');

assert.equal(cjsRoot.default, cjsRoot.Digikala);
assert.equal(cjsBrowser.runtime, 'browser');
assert.equal(cjsNode.runtime, 'node');
assert.equal(typeof cjsSchemas.VariantCreateInputSchema.safeParse, 'function');
assert.equal(typeof cjsAccountManager.createDigikalaAccountManager, 'function');

console.log('ESM and CommonJS package exports are valid.');
