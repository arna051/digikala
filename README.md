# Digikala Seller SDK for TypeScript

**By: Hippogriff Studio**  
[https://hippogriff.ir](https://hippogriff.ir)  
**Call me:** [+989038719255](tel:+989038719255)

> **DO NOT FORGET TO DONATE!** Your support helps maintain and improve this
> open-source package.

A strongly typed SDK for the Digikala Seller OpenAPI, built for reliable
Node.js integrations with clearly separated browser-safe, webhook, account
management, and MCP entry points.

## Features

- TypeScript-first API with exported types and interfaces
- Runtime request and response validation with Zod
- Axios transport with a 60-second default timeout
- Automatic access-token refresh and safe credential lifecycle management
- Product, variant, inventory, and order resources
- Deterministic product and variant creation workflows
- Optional SQLite caching with 24-hour freshness and forced refresh support
- Optional local semantic search over cached catalog data
- Encrypted, multi-account Digikala account management
- Cross-account product, inventory, reservation, and order tracking
- Framework-neutral webhooks with an Express adapter
- Permission-controlled MCP integration for AI clients
- ESM, CommonJS, Node.js, and browser-safe package exports

## Requirements

- Node.js 20 or newer
- A Digikala seller account with OpenAPI access
- npm, pnpm, or Yarn

> [!IMPORTANT]
> Private keys, access tokens, and refresh tokens belong on the server. Browser
> applications must communicate with a trusted backend and must never receive
> Digikala credentials.

## Installation

```sh
npm install digikala
```

## Quick start

```ts
import Digikala, { Types } from 'digikala';
import type { DigikalaClientOptions } from 'digikala';

const options: Types.DigikalaClientOptions = { timeoutMs: 60_000 };
const client = new Digikala(options);
```

Validate data before calling the SDK with the same Zod schemas used internally:

```ts
import { Schemas } from 'digikala';

const result = Schemas.Variants.updateStock.safeParse({
  variantId: 123,
  sellerStock: 10,
});
```

Runtime-specific imports are available from `digikala/browser` and
`digikala/node`. Webhook and MCP integrations use their own subpath exports so
Node-only dependencies cannot leak into browser bundles.

### Package entry points

| Import                      | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `digikala`                  | Universal types, schemas, and core exports   |
| `digikala/node`             | Authenticated Node.js seller client          |
| `digikala/browser`          | Browser-safe exports without server secrets  |
| `digikala/schemas`          | Database-safe Zod contracts and domain types |
| `digikala/auth/node`        | RSA credentials and authentication lifecycle |
| `digikala/account-manager`  | Encrypted SQLite multi-account management    |
| `digikala/webhooks`         | Framework-neutral webhook handling           |
| `digikala/webhooks/express` | Express webhook adapter                      |
| `digikala/mcp`              | Model Context Protocol server integration    |

## Create and authenticate an account

Authentication and RSA key operations are Node-only:

```ts
import { DigikalaAuth } from 'digikala/auth/node';

const pendingAccount = await DigikalaAuth.createAccount({
  vendor: {
    id: 'vendor-1',
    name: 'Example Store',
    sellerCode: 'seller-code',
  },
});

// Save this database-ready object, then register its public key with Digikala.
const waitingAccount = DigikalaAuth.markPublicKeyRegistered(pendingAccount);

const authenticatedAccount = await DigikalaAuth.completeAuthentication({
  account: waitingAccount,
  authorizationCode: encryptedAuthorizationCode,
});
```

Every transition returns a new serializable account object. Use
`DigikalaAccount.toVendorSummary(account)` before returning account information
to a browser UI; never send the complete credentials object to the browser.

## Restore an account from your database

Implement the database-agnostic store contract and let the Node client validate
the stored object before use:

```ts
import Digikala from 'digikala/node';

const client = new Digikala({
  vendorId: 'vendor-1',
  accountStore: myAccountStore,
});

await client.connect();
console.log(client.vendor); // Safe summary without credentials.
```

Store `save` implementations receive an `expectedRevision` value so database
adapters can reject stale token updates.

## Refresh access tokens

The Node client refreshes access tokens five minutes before expiry by default.
Concurrent requests share one refresh operation, and rotated access and refresh
tokens are saved through the account store before an API request uses them. A
request rejected with HTTP 401 triggers one forced refresh and one retry; it
never loops indefinitely.

```ts
const client = new Digikala({
  vendorId: 'vendor-1',
  accountStore: myAccountStore,
  tokenRefresh: {
    skewMs: 5 * 60_000,
  },
});

await client.connect();
await client.refreshAuthentication(); // Optional explicit refresh.
```

Your store must atomically compare `expectedRevision` and persist the complete
new account record. Digikala may rotate the refresh token, so saving only the
access token can permanently disconnect the vendor. When the refresh token has
expired or Digikala rejects it, the client clears the tokens and transitions
the account to `reauthorization_required`; show that state in your vendor UI and
restart the authorization flow. Temporary network failures leave the existing
account unchanged and are surfaced to the caller.

Automatic refresh can be disabled with `tokenRefresh: { automatic: false }`.
The `exchange` and `now` hooks are intended for controlled tests and custom
infrastructure; applications should normally use the built-in Digikala
exchange.

## Send validated API requests

The Node client owns an Axios transport configured with the fixed Digikala API
origin and a 60-second default timeout. Each operation validates its input
before reading credentials or making a network request, then validates the API
response:

```ts
import { z } from 'zod';
import Digikala, { Schemas } from 'digikala/node';

const client = new Digikala({ account: authenticatedAccount });
const result = await client.transport.request({
  method: 'GET',
  path: 'variants',
  input: {},
  inputSchema: Schemas.Variants.list,
  outputSchema: z.object({ status: z.string() }).passthrough(),
  serialize: (input) => ({ params: input }),
});
```

The transport sets the bearer token and required seller user-agent internally;
request serializers cannot override security-sensitive headers. Browser code
must call your own backend/BFF and must never receive private keys or tokens.

Most applications should use the resource modules instead of calling the
transport directly:

```ts
const variants = await client.variants.list({
  search: { active: true, categoryIds: [10, 20] },
});

await client.variants.updateStock({ variantId: 123, sellerStock: 8 });
const products = await client.products.list({ page: 1 });
const orders = await client.orders.list({ search: { createdToday: true } });
```

Available operations include variant list/detail/stock, stock and price
updates, activation changes, seller product listing and content score, order
listing/history/statistics/cancellation, seller profile sections, DK shipment
management, and product editing/publishing.

Service Hub is treated as the behavioral documentation layer, while the
Swagger specification remains the machine-readable contract. The complete
authenticated contract is generated into 36 dedicated domain modules with 277
typed, Zod-validated operations:

```ts
const inventory = await client.api.inventories.getInventories({
  query: { page: 1, size: 50 },
});

const campaigns = await client.api.searchAds.getSearchAdsV2Campaigns({
  query: { page: 1 },
});

const packages = await client.api.packages.getPackages({
  query: { 'search[status]': 'new' },
});
```

Inputs are deliberately separated into `path`, `query`, and `body`, so unusual
Digikala field names remain exact and no query value can accidentally enter a
URL path. Authentication and health-check operations stay in the specialized
authentication layer.

The safe generic bridge remains available for newly released or undocumented
operations. It still applies authentication, fixed-origin path checks, the
60-second timeout, rate limiting, and JSON headers:

```ts
const balance = await client.serviceHub.request({
  method: 'GET',
  path: 'shipping-services/wallet/balance',
});
```

The earlier ergonomic resources remain stable for common workflows:

```ts
const profile = await client.profile.get({ mini: true });
const business = await client.profile.business();

const history = await client.orders.history({
  orderType: 'returned',
  shippingType: 'digikala',
});
const statistics = await client.orders.statistics();

const shipments = await client.shipments.list({
  search: { shipmentStatus: 'new' },
});
const packages = await client.shipments.packages({ warehouseId: 123 });

const editable = await client.productEditing.get(productId);
await client.productEditing.update({
  productId,
  categoryId,
  brandId,
  isIranian: false,
  titleFa: 'عنوان ویرایش‌شده',
});
await client.productEditing.publish({ productId });
```

## Create products and variants

Creation is exposed as deterministic, validated resource methods. It does not
guess catalog data and does not use an LLM.

The SDK follows Digikala's content lifecycle: a newly saved product is a
`draft`; releasing it moves it to `waiting_for_confirm`; only `approved`
products can receive variants. `in_review` products must be corrected,
`removed` products cannot be reused, and a `duplicate` result points to the
existing DKP that should receive the variant instead.

Terminology is reflected in the public schemas:

- DKP (`productId`) is the shared catalog product across all sellers.
- DKPC (`variantId`) is a seller-specific sellable variant of that DKP.
- A category may require no theme, one theme, or at most two themes (currently
  multi-theme is used for fashion combinations such as color and size).

For a product that already exists in Digikala's catalog, search it, verify that
the current seller may sell it, assign it to the seller, then fetch its live
variant requirements before creating a variant:

```ts
const matches = await client.productCreation.search({ keyword: 'ماگ سرامیکی' });
const productId = matches.data.products[0]!.id;

await client.productCreation.getSellability(productId);
await client.productCreation.assign(productId);

const requirements = await client.variantCreation.getRequirements(productId);
// Build the input from `requirements`; package fields and lead time can be
// required for one product even when they are optional for another.
const created = await client.variantCreation.create({
  productId,
  isActive: false,
  marketplaceSellerStock: 0,
  orderLimit: 2,
  warrantyId: 272,
  colorId: 2,
  site: 'digikala',
  shippingType: 'digikala',
  leadTime: 1,
  packageLength: 12,
  packageWidth: 8,
  packageHeight: 10,
  packageWeight: 330,
});
```

`getRequirements()` is remembered by the resource. The following `create()`
automatically validates lead-time limits, package dimension bounds, required
size-guide data, mandatory main images, and allowed theme IDs before making a
network request. Requirements can also be supplied explicitly, which is useful
when they were persisted:

```ts
await client.variantCreation.create(input, {
  requirements: savedRequirements,
});
```

Prices are raw Digikala API values in **rial**, not UI toman. Variant stock may
be zero, while `orderLimit` must be at least 2. Always use
`getRequirements(productId)` rather than hard-coding package, theme, shipping,
or lead-time requirements. Creation `POST` requests are not automatically
retried: after an uncertain network result, reconcile by supplier code or a
read operation before deciding whether to submit again.

For a genuinely new catalog product, use the draft workflow:

1. Search and validate the category.
2. Validate details and save the returned draft product ID.
3. Fetch, fill, and validate category attributes.
4. Upload and validate images, save title, then submit the draft.
5. Resume after moderation; once approved, fetch variant requirements and
   create the seller variant.

The workflow state is serializable, so applications can persist it in a
database or state machine between user-input and moderation steps:

```ts
import { advanceCreationWorkflow, createCreationWorkflow } from 'digikala/node';

let workflow = createCreationWorkflow({
  vendorId: 'vendor-1',
  mode: 'new_product',
});

workflow = advanceCreationWorkflow(workflow, {
  type: 'details_validated',
  draftProductId: 456,
});
await workflowStore.save(workflow);
```

Reference-data requests for missing brands, colors, sizes, and warranties are
separate explicit operations. They can require Digikala review and should not
be treated as successful product creation. For cleanup, first set stock to
zero and deactivate or archive the variant:

```ts
await client.variants.updateStock({ variantId, sellerStock: 0 });
await client.variants.archive(variantId);
```

## Cache products and variants with SQLite

The optional Node-only cache stores validated list responses for 24 hours by
default. SQLite, vector search, and local model dependencies are optional and
are never included in browser exports:

```sh
npm install better-sqlite3 sqlite-vec
```

```ts
import Digikala from 'digikala/node';

const client = new Digikala({
  account: authenticatedAccount,
  cache: {
    sqlite: { filename: './data/digikala.sqlite' },
    ttlMs: 24 * 60 * 60_000,
  },
});

await client.products.list(); // Network on a miss, then SQLite.
await client.products.list(); // Fresh cached response.
await client.products.list({}, { forceRefresh: true });
```

Advanced callers can use `cachePolicy: 'prefer-cache'`, `'refresh'`,
`'cache-only'`, or `'network-only'`. Concurrent misses for the same vendor and
query share one request. Successful stock, price, and activation mutations
invalidate cached variant data.

Synchronize complete product and variant snapshots at application startup or
on a schedule:

```ts
const summary = await client.cache?.refreshAll({
  resources: ['products', 'variants'],
  pageSize: 50,
  onProgress: ({ resource, page, records }) => {
    console.log(resource, page, records);
  },
});
```

All pages are fetched and validated before one SQLite transaction replaces the
previous snapshot. A failed or cancelled refresh leaves the prior snapshot
intact.

### Local semantic search

Enable the local Transformers.js embedder to store vectors in a separate
`semantic_embeddings` table. The default multilingual E5 model is downloaded
and cached by Transformers.js on first use:

```sh
npm install @huggingface/transformers
```

```ts
const client = new Digikala({
  account: authenticatedAccount,
  cache: {
    sqlite: { filename: './data/digikala.sqlite' },
    semantic: true,
  },
});

await client.cache?.refreshAll({ generateEmbeddings: true });

const matches = await client.cache?.semanticSearch({
  query: 'گوشی با حافظه زیاد',
  resources: ['products', 'variants'],
  limit: 20,
});
```

Applications can supply their own `DigikalaEmbeddingProvider` instead. Stored
vectors include their model and dimensions, preventing queries from comparing
incompatible embedding spaces. Credentials and tokens are never written to the
cache database.

## Manage multiple Digikala accounts

The Node-only account manager owns registration, encrypted credential storage,
token persistence, caching, cross-account tracking, inventory, reservations,
and unified orders. Generate a 32-byte encryption key once and store it outside
the database, such as in an environment secret:

```sh
openssl rand -base64 32
```

```ts
import { createDigikalaAccountManager } from 'digikala/account-manager';

const manager = await createDigikalaAccountManager({
  sqlite: { filename: './data/digikala.sqlite' },
  encryptionKey: process.env.DIGIKALA_STORAGE_KEY!,
  cache: {
    ttlMs: 24 * 60 * 60_000,
    semantic: true,
  },
});
```

Account registration persists the generated private key internally and returns
only the public key needed for Digikala onboarding:

```ts
const registration = await manager.accounts.register({
  vendor: {
    id: 'vendor-1',
    name: 'Main Store',
    sellerCode: 'seller-code',
  },
});

await registerWithDigikala(registration.publicKey);
await manager.accounts.markPublicKeyRegistered('vendor-1');

await manager.accounts.completeRegistration({
  vendorId: 'vendor-1',
  authorizationCode: encryptedAuthorizationCode,
});
```

Private keys and tokens are encrypted with AES-256-GCM before SQLite receives
them. The database file is restricted to owner read/write permissions. Losing
the external encryption key makes the stored accounts unrecoverable, so back it
up separately.

Synchronize every authenticated account into one local operational view:

```ts
const result = await manager.syncAll({
  resources: ['catalog', 'inventory', 'orders', 'embeddings'],
});

const products = await manager.tracking.listProducts();
const inventory = await manager.tracking.getInventory(123);
const orders = await manager.orders.list();
```

Tracking is automatic. Products from different seller panels are correlated by
Digikala's common `product_id`. Variants are correlated by
`product_variant_id`, while each account's local variant `id` is retained for
stock operations. Inventory results expose each account separately and provide
aggregate selling stock, marketplace stock, warehouse stock, incoming stock,
and reservation totals. Orders use a composite vendor/order/item identity, so
identical order numbers from different panels never collide.

Order mutations always require an explicit vendor:

```ts
await manager.orders.cancelItem({
  vendorId: 'vendor-2',
  orderItemId: 123,
  cancellationReasonId: 7,
});
```

Call `await manager.close()` during application shutdown.

## Receive webhooks

Digikala documents webhook delivery as at least once, so handlers should use a
shared atomic idempotency store in production. Digikala does not currently
document a signature header; provide authentication appropriate to the secret
endpoint configuration instead of assuming one:

```ts
import { createExpressWebhookHandler } from 'digikala/webhooks/express';

app.post(
  '/digikala/webhook',
  express.json({ limit: '1mb' }),
  createExpressWebhookHandler({
    verifyRequest: (request) =>
      request.headers?.authorization === `Bearer ${process.env.WEBHOOK_SECRET}`,
    idempotencyStore: myAtomicIdempotencyStore,
    idempotencyKey: (event) => makeVendorScopedKey(event),
    idempotencyTtlMs: 5 * 60_000,
    handlers: {
      product_variant_status_change: async (event) => {
        await updateVariant(event.data.product_variant_id, event.data.active);
      },
    },
    onError: (error) => logger.error(error),
  }),
);
```

The core `createDigikalaWebhookHandler` export is framework-neutral. Express is
optional and is not installed by this package. For local development only, an
explicit `allowUnauthenticated: true` option is available. Without a custom key
resolver, the receiver hashes the validated payload and keeps the claim for
five minutes; use a vendor-scoped delivery identifier when your infrastructure
provides one.

## MCP server for AI clients

The Node-only MCP integration exposes seller reads by default and keeps account
credentials out of tool results:

```ts
import { connectDigikalaMcpStdio } from 'digikala/mcp';

await connectDigikalaMcpStdio({ client });
```

Available read tools cover variant list/detail/stock, product list/content
score, and active orders. Mutating tools are not registered unless the host
enables them and authorizes every individual call:

```ts
await connectDigikalaMcpStdio({
  client,
  allowMutations: true,
  authorizeMutation: async ({ tool, input, vendor }) =>
    await myApprovalPolicy({ tool, input, vendorId: vendor.id }),
});
```

The mutation tools update stock, price, and activation status or cancel an
order item. Denied calls and SDK errors return sanitized MCP errors; detailed
errors are available only through the optional server-side `onError` callback.

## Support the project

If this SDK saves you development time, please support its continued
maintenance.

> **DO NOT FORGET TO DONATE!**

For support, collaboration, or donation details, visit
[Hippogriff Studio](https://hippogriff.ir) or call
[+989038719255](tel:+989038719255).

## License

Released under the MIT License.
