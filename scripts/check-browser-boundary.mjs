import { readFile } from 'node:fs/promises';

const browserBundle = await readFile(
  new URL('../dist/browser/index.js', import.meta.url),
  'utf8',
);

const forbiddenPatterns = [
  /node:/,
  /BEGIN PRIVATE KEY/,
  /refresh[_A-Z-]?token/i,
  /private[_A-Z-]?key/i,
  /@modelcontextprotocol/,
  /node:crypto/,
  /DigikalaIdentity/,
  /completeAuthentication/,
  /DigikalaAxiosTransport/,
  /DigikalaTrustedBot\/SelfToken/,
  /DigikalaVariantsResource/,
  /better-sqlite3/,
  /sqlite-vec/,
  /TransformersJsEmbeddingProvider/,
  /DigikalaAccountManager/,
  /manager_accounts/,
  /aes-256-gcm/,
];

for (const pattern of forbiddenPatterns) {
  if (pattern.test(browserBundle)) {
    throw new Error(`Browser bundle contains forbidden pattern: ${pattern}`);
  }
}

console.log('Browser bundle boundary is clean.');
