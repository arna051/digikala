import assert from 'node:assert/strict';

const specificationUrl =
  'https://seller.digikala.com/open-api/v1/doc/specification.yml';
const serviceHubUrl = 'https://servicehub.digikala.services/fa/home';

const requiredOperations = [
  ['GET', '/open-api/v1/profile'],
  ['PATCH', '/open-api/v1/profile/business'],
  ['GET', '/open-api/v1/shipments/dk'],
  ['POST', '/open-api/v1/shipments/dk'],
  ['GET', '/open-api/v1/shipments/dk/packages'],
  ['DELETE', '/open-api/v1/shipments/dk/{shipment_id}'],
  ['GET', '/open-api/v1/orders/statistics'],
  ['GET', '/open-api/v1/orders/history'],
  ['GET', '/open-api/v1/product-edit/{product_id}'],
  ['PUT', '/open-api/v1/product-edit/{product_id}'],
  ['POST', '/open-api/v1/product-edit/{product_id}/publish'],
];

const [specificationResponse, serviceHubResponse] = await Promise.all([
  fetch(specificationUrl, { signal: AbortSignal.timeout(20_000) }),
  fetch(serviceHubUrl, { signal: AbortSignal.timeout(20_000) }),
]);
assert.equal(
  specificationResponse.ok,
  true,
  `Swagger contract returned ${specificationResponse.status}`,
);
assert.equal(
  serviceHubResponse.ok,
  true,
  `Service Hub returned ${serviceHubResponse.status}`,
);

const specification = await specificationResponse.text();
for (const [method, path] of requiredOperations) {
  const unquotedStart = specification.indexOf(`\n    ${path}:`);
  const quotedStart = specification.indexOf(`\n    '${path}':`);
  const start = Math.max(unquotedStart, quotedStart);
  const nextUnquoted = specification.indexOf(
    '\n    /open-api/v1/',
    start + path.length,
  );
  const nextQuoted = specification.indexOf(
    "\n    '/open-api/v1/",
    start + path.length,
  );
  const candidates = [nextUnquoted, nextQuoted].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : -1;
  const operationBlock = specification.slice(
    start,
    end === -1 ? specification.length : end,
  );
  assert.ok(
    start >= 0 && operationBlock.includes(`${method.toLowerCase()}: {`),
    `Missing ${method} ${path}`,
  );
}

const serviceHub = await serviceHubResponse.text();
assert.match(serviceHub, /سرویس.?هاب|Service Hub/i);
console.log('Swagger and Service Hub contracts are reachable and compatible.');
