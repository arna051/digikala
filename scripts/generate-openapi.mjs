import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';
import prettier from 'prettier';

const SPEC_URL =
  'https://seller.digikala.com/open-api/v1/doc/specification.yml';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDirectory = path.join(root, 'spec');
const outputDirectory = path.join(root, 'src/generated');
const snapshotPath = path.join(specDirectory, 'digikala-openapi.yml');
const prettierConfig =
  (await prettier.resolveConfig(path.join(root, 'src/index.ts'))) ?? {};
const check = process.argv.includes('--check');
const useSnapshot = process.argv.includes('--snapshot');
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);

const remoteText = useSnapshot
  ? await readFile(snapshotPath, 'utf8')
  : await fetchSpec();
const specification = YAML.parse(remoteText);

if (specification.openapi !== '3.0.0') {
  throw new Error(`Unsupported OpenAPI version: ${specification.openapi}`);
}

const operations = [];
for (const [apiPath, pathItem] of Object.entries(specification.paths ?? {})) {
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!methods.has(method)) continue;
    operations.push({ apiPath, method, operation });
  }
}

if (operations.length !== 283) {
  throw new Error(`Expected 283 operations, received ${operations.length}`);
}

const excludedTags = new Set(['Authentication', 'Health-check']);
const domainNames = {
  Batch: ['batch', 'DigikalaBatchApi'],
  Webhook: ['webhooks', 'DigikalaWebhookApi'],
  Category: ['categories', 'DigikalaCategoryApi'],
  Product: ['products', 'DigikalaProductApi'],
  'Product Variant': ['variants', 'DigikalaProductVariantApi'],
  'Product Variant - Creation': [
    'variantCreation',
    'DigikalaProductVariantCreationApi',
  ],
  Package: ['packages', 'DigikalaPackageApi'],
  'Post Tracking Code': ['postTracking', 'DigikalaPostTrackingCodeApi'],
  SBS: ['sbs', 'DigikalaSbsApi'],
  'SBS Settings': ['sbsSettings', 'DigikalaSbsSettingsApi'],
  'SBS Orders': ['sbsOrders', 'DigikalaSbsOrdersApi'],
  'SBS nearby stores': ['sbsNearbyStores', 'DigikalaSbsNearbyStoresApi'],
  Order: ['orders', 'DigikalaOrderApi'],
  Lightening: ['lightningDeals', 'DigikalaLightningDealsApi'],
  PLP: ['plp', 'DigikalaPlpApi'],
  'Questions & Answers': ['questions', 'DigikalaQuestionsApi'],
};
const grouped = new Map();
for (const item of operations) {
  const tag = cleanTag(item.operation.tags?.[0] ?? 'Miscellaneous');
  if (excludedTags.has(tag)) continue;
  const group = grouped.get(tag) ?? [];
  group.push(item);
  grouped.set(tag, group);
}

const generated = new Map();
generated.set('runtime.ts', runtimeSource());
const modules = [];
const usedProperties = new Set();
for (const [tag, items] of grouped) {
  const file = unique(
    slug(tag),
    modules.map((entry) => entry.file),
  );
  const className = domainNames[tag]?.[1] ?? `Digikala${pascal(tag)}Api`;
  const property = unique(domainNames[tag]?.[0] ?? camel(tag), usedProperties);
  usedProperties.add(property);
  const source = resourceSource(tag, className, items);
  generated.set(`${file}.ts`, source);
  modules.push({ tag, file, className, property, count: items.length });
}
generated.set('api.ts', apiSource(modules));
generated.set('index.ts', indexSource(modules));

const coverage = {
  specification: SPEC_URL,
  sha256: createHash('sha256').update(remoteText).digest('hex'),
  operations: operations.length,
  generatedOperations: [...grouped.values()].reduce(
    (total, entries) => total + entries.length,
    0,
  ),
  specializedOperations:
    operations.length -
    [...grouped.values()].reduce((total, entries) => total + entries.length, 0),
  domains: Object.fromEntries(
    modules.map((item) => [item.property, item.count]),
  ),
};
generated.set('coverage.json', `${JSON.stringify(coverage, null, 2)}\n`);
for (const [file, source] of generated) {
  generated.set(
    file,
    await prettier.format(source, { ...prettierConfig, filepath: file }),
  );
}

if (check) {
  const failures = [];
  for (const [file, expected] of generated) {
    const actual = await readFile(
      path.join(outputDirectory, file),
      'utf8',
    ).catch(() => undefined);
    if (actual !== expected) failures.push(file);
  }
  if (failures.length > 0) {
    throw new Error(
      `Generated OpenAPI files are stale: ${failures.join(', ')}. Run npm run generate:openapi.`,
    );
  }
  console.log(
    `OpenAPI output is current (${coverage.generatedOperations} generated operations).`,
  );
} else {
  await mkdir(specDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(snapshotPath, remoteText);
  await Promise.all(
    [...generated].map(([file, source]) =>
      writeFile(path.join(outputDirectory, file), source),
    ),
  );
  console.log(
    `Generated ${coverage.generatedOperations} operations in ${modules.length} domain modules.`,
  );
}

async function fetchSpec() {
  const response = await fetch(SPEC_URL, {
    headers: { accept: 'application/yaml, text/yaml, text/plain' },
  });
  if (!response.ok) {
    throw new Error(`OpenAPI download failed with HTTP ${response.status}`);
  }
  return response.text();
}

function cleanTag(tag) {
  return tag
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\bAPI\b/g, '')
    .trim();
}

function words(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function pascal(value) {
  const result = words(value)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  return /^\d/.test(result) ? `V${result}` : result || 'Miscellaneous';
}

function camel(value) {
  const result = pascal(value);
  return result[0].toLowerCase() + result.slice(1);
}

function slug(value) {
  return words(value)
    .map((part) => part.toLowerCase())
    .join('-');
}

function unique(value, used) {
  const has = (candidate) =>
    used instanceof Set ? used.has(candidate) : used.includes(candidate);
  if (!has(value)) return value;
  let index = 2;
  while (has(`${value}${index}`)) index += 1;
  return `${value}${index}`;
}

function operationName(method, apiPath, usedNames) {
  const segments = apiPath
    .replace(/^\/open-api\/v1\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith('{') ? `By ${segment.slice(1, -1)}` : segment,
    );
  return unique(camel(`${method} ${segments.join(' ')}`), usedNames);
}

function schemaExpression(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 30) return 'z.unknown()';
  if (schema.nullable) {
    return `${schemaExpression({ ...schema, nullable: false }, depth)}.nullable()`;
  }
  if (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.enum.every(
      (value) =>
        value === null ||
        ['string', 'number', 'boolean'].includes(typeof value),
    )
  ) {
    const literals = schema.enum.map(
      (value) => `z.literal(${JSON.stringify(value)})`,
    );
    return literals.length === 1
      ? literals[0]
      : `z.union([${literals.join(', ')}])`;
  }
  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const expressions = variants.map((item) =>
      schemaExpression(item, depth + 1),
    );
    return expressions.length === 1
      ? expressions[0]
      : `z.union([${expressions.join(', ')}])`;
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const expressions = schema.allOf.map((item) =>
      schemaExpression(item, depth + 1),
    );
    return expressions.reduce((left, right) => `${left}.and(${right})`);
  }
  const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const type = typeof rawType === 'string' ? rawType.split(',')[0] : rawType;
  if (type === 'boolean') {
    return typeof schema.example === 'boolean'
      ? 'z.boolean()'
      : primitiveFallback('z.boolean()', schema.example);
  }
  if (type === 'integer') {
    return primitiveFallback(numericExpression(schema, true), schema.example);
  }
  if (type === 'number') {
    return primitiveFallback(numericExpression(schema, false), schema.example);
  }
  if (type === 'array') {
    return `z.array(${schemaExpression(schema.items, depth + 1)})`;
  }
  if (type === 'object' || schema.properties || schema.additionalProperties) {
    const required = new Set(
      Array.isArray(schema.required) ? schema.required : [],
    );
    const properties = Object.entries(schema.properties ?? {}).map(
      ([name, child]) => {
        let expression = schemaExpression(child, depth + 1);
        if (!required.has(name)) expression += '.optional()';
        return `${JSON.stringify(name)}: ${expression}`;
      },
    );
    if (properties.length === 0 && schema.additionalProperties) {
      return `z.record(z.string(), ${schemaExpression(schema.additionalProperties, depth + 1)})`;
    }
    return `z.object({${properties.join(', ')}}).passthrough()`;
  }
  if (type === 'string') {
    let expression = 'z.string()';
    if (Number.isFinite(schema.minLength))
      expression += `.min(${schema.minLength})`;
    if (Number.isFinite(schema.maxLength))
      expression += `.max(${schema.maxLength})`;
    return primitiveFallback(expression, schema.example);
  }
  return 'z.unknown()';
}

function primitiveFallback(expression, example) {
  if (example === null || example === undefined) return expression;
  const fallback =
    typeof example === 'string'
      ? 'z.string()'
      : typeof example === 'number'
        ? 'z.number()'
        : typeof example === 'boolean'
          ? 'z.boolean()'
          : undefined;
  if (!fallback || expression.startsWith(fallback)) return expression;
  return `z.union([${expression}, ${fallback}])`;
}

function numericExpression(schema, integer) {
  let expression = integer ? 'z.number().int()' : 'z.number()';
  if (Number.isFinite(schema.minimum)) expression += `.min(${schema.minimum})`;
  if (Number.isFinite(schema.maximum)) expression += `.max(${schema.maximum})`;
  return expression;
}

function requestSchema(operation) {
  const fields = [];
  const pathParameters = (operation.parameters ?? []).filter(
    (parameter) => parameter.in === 'path',
  );
  const queryParameters = (operation.parameters ?? []).filter(
    (parameter) => parameter.in === 'query',
  );
  if (pathParameters.length > 0) {
    const body = pathParameters.map(
      (parameter) =>
        `${JSON.stringify(parameter.name)}: ${schemaExpression(parameter.schema)}${parameter.required ? '' : '.optional()'}`,
    );
    fields.push(`path: z.object({${body.join(', ')}}).strict()`);
  }
  if (queryParameters.length > 0) {
    const body = queryParameters.map(
      (parameter) =>
        `${JSON.stringify(parameter.name)}: ${schemaExpression(parameter.schema)}${parameter.required ? '' : '.optional()'}`,
    );
    const queryRequired = queryParameters.some(
      (parameter) => parameter.required,
    );
    fields.push(
      `query: z.object({${body.join(', ')}}).strict()${queryRequired ? '' : '.optional()'}`,
    );
  }
  const requestBody = operation.requestBody;
  const bodySchema = requestBody?.content?.['application/json']?.schema;
  if (requestBody) {
    fields.push(
      `body: ${schemaExpression(bodySchema)}${requestBody.required ? '' : '.optional()'}`,
    );
  }
  return {
    expression: `z.object({${fields.join(', ')}}).strict()`,
    canDefault:
      fields.length === 0 ||
      (!pathParameters.some((parameter) => parameter.required) &&
        !queryParameters.some((parameter) => parameter.required) &&
        !requestBody?.required),
    pathParameters,
    hasQuery: queryParameters.length > 0,
    hasBody: Boolean(requestBody),
  };
}

function responseSchema(operation) {
  const responses = operation.responses ?? {};
  const success =
    responses['200'] ??
    responses['201'] ??
    responses['202'] ??
    responses['204'];
  const schema =
    success?.content?.['application/json']?.schema ??
    success?.content?.['application/pdf']?.schema;
  return schemaExpression(normalizeResponseSchema(schema));
}

/**
 * Digikala's live responses commonly use null for absent scalar values and add
 * enum values before updating Swagger. Inputs stay strict; outputs accept those
 * compatible evolutions while retaining their documented object structure.
 */
function normalizeResponseSchema(schema, propertyName) {
  if (!schema || typeof schema !== 'object') return schema;
  const normalized = { ...schema, nullable: true };
  delete normalized.enum;
  if (normalized.properties) {
    normalized.properties = Object.fromEntries(
      Object.entries(normalized.properties).map(([name, child]) => [
        name,
        normalizeResponseSchema(child, name),
      ]),
    );
  }
  if (normalized.items) {
    normalized.items = normalizeResponseSchema(normalized.items);
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(normalized[keyword])) {
      normalized[keyword] = normalized[keyword].map((child) =>
        normalizeResponseSchema(child),
      );
    }
  }
  // Live list metadata uses either a documented scalar or an array of choices.
  if (propertyName === 'sort_columns') {
    return {
      anyOf: [normalized, { type: 'array', items: {}, nullable: true }],
      nullable: true,
    };
  }
  // List endpoints disagree on whether empty metadata is `{}` or `[]`.
  if (propertyName === 'meta_data') {
    return {
      anyOf: [normalized, { type: 'array', items: {}, nullable: true }],
      nullable: true,
    };
  }
  // Some live endpoints return Carbon-style date objects while their schema
  // advertises ISO strings.
  if (
    typeof propertyName === 'string' &&
    /(?:_at|_date|date_at)$/.test(propertyName) &&
    normalized.type === 'string'
  ) {
    return {
      anyOf: [
        normalized,
        { type: 'object', additionalProperties: true, nullable: true },
      ],
      nullable: true,
    };
  }
  return normalized;
}

function resourceSource(tag, className, operationsForTag) {
  const constants = [];
  const classMethods = [];
  const usedNames = new Set();
  for (const { apiPath, method, operation } of operationsForTag) {
    const name = operationName(method, apiPath, usedNames);
    usedNames.add(name);
    const typeName = pascal(name);
    const input = requestSchema(operation);
    const output = responseSchema(operation);
    constants.push(
      `export const ${typeName}InputSchema = ${input.expression};`,
      `export const ${typeName}OutputSchema = ${output};`,
      `export type ${typeName}Input = z.input<typeof ${typeName}InputSchema>;`,
      `export type ${typeName}Output = z.output<typeof ${typeName}OutputSchema>;`,
    );
    let pathExpression = JSON.stringify(
      apiPath.replace(/^\/open-api\/v1\/?/, ''),
    );
    for (const parameter of input.pathParameters) {
      pathExpression = pathExpression.replace(
        `{${parameter.name}}`,
        `\${encodeURIComponent(String(input.path[${JSON.stringify(parameter.name)}]))}`,
      );
    }
    if (pathExpression.includes('${'))
      pathExpression = `\`${pathExpression.slice(1, -1)}\``;
    const serialization = [];
    if (input.hasQuery) serialization.push('params: input.query');
    if (input.hasBody) serialization.push('data: input.body');
    const serializer =
      serialization.length > 0
        ? `serialize: (input) => ({${serialization.join(', ')}})`
        : 'serialize: () => ({})';
    const parameter = input.canDefault
      ? `input: ${typeName}Input = {}`
      : `input: ${typeName}Input`;
    const description = String(operation.description ?? '')
      .replace(/\*\//g, '* /')
      .replace(/\s+/g, ' ')
      .trim();
    classMethods.push(`  /**
   * ${description || `${method.toUpperCase()} ${apiPath}`}
   * @scope ${operation.summary?.replace(/^Scopes?\s*=>\s*/i, '') ?? 'unspecified'}
   * @operation ${method.toUpperCase()} ${apiPath}
   */
  ${name}(${parameter}): Promise<${typeName}Output> {
    return this.transport.request({
      method: ${JSON.stringify(method.toUpperCase())},
      path: ${pathExpression},
      input,
      inputSchema: ${typeName}InputSchema,
      outputSchema: ${typeName}OutputSchema,
      ${serializer},
    });
  }`);
  }
  return `// @generated by scripts/generate-openapi.mjs — do not edit directly.
import { z } from 'zod';

import type { DigikalaAxiosTransport } from '../transport/node-transport.js';

${constants.join('\n')}

/** Dedicated ${tag} operations from the official Seller OpenAPI. */
export class ${className} {
  constructor(private readonly transport: DigikalaAxiosTransport) {}

${classMethods.join('\n\n')}
}
`;
}

function runtimeSource() {
  return `// @generated by scripts/generate-openapi.mjs — do not edit directly.\nexport const DIGIKALA_OPENAPI_OPERATION_COUNT = 283 as const;\nexport const DIGIKALA_GENERATED_OPERATION_COUNT = 277 as const;\n`;
}

function apiSource(modules) {
  const imports = modules
    .map(
      ({ file, className }) => `import { ${className} } from './${file}.js';`,
    )
    .join('\n');
  const properties = modules
    .map(({ property, className }) => `  readonly ${property}: ${className};`)
    .join('\n');
  const assignments = modules
    .map(
      ({ property, className }) =>
        `    this.${property} = new ${className}(transport);`,
    )
    .join('\n');
  return `// @generated by scripts/generate-openapi.mjs — do not edit directly.
import type { DigikalaAxiosTransport } from '../transport/node-transport.js';
${imports}

/** Complete authenticated Seller OpenAPI, separated by business domain. */
export class DigikalaSellerApi {
${properties}

  constructor(transport: DigikalaAxiosTransport) {
${assignments}
  }
}
`;
}

function indexSource(modules) {
  return `// @generated by scripts/generate-openapi.mjs — do not edit directly.\nexport { DigikalaSellerApi } from './api.js';\nexport * from './runtime.js';\n${modules.map(({ file }) => `export * from './${file}.js';`).join('\n')}\n`;
}
