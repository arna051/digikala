import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type {
  DigikalaCacheEntry,
  DigikalaCacheSnapshot,
  DigikalaCacheStore,
  DigikalaSemanticMatch,
} from './types.js';

interface CacheRow {
  value_json: string;
  fetched_at: string;
  expires_at: string;
}
interface SearchRow {
  resource: 'products' | 'variants';
  entity_id: string;
  data_json: string;
  distance: number;
}

export class SqliteDigikalaCacheStore implements DigikalaCacheStore {
  readonly #database: Database.Database;

  constructor(options: { filename: string }) {
    const require = createRequire(import.meta.url);
    let DatabaseConstructor: typeof Database;
    let loadVectorExtension: (database: Database.Database) => void;
    try {
      DatabaseConstructor = require('better-sqlite3') as typeof Database;
      const vectorModule = require('sqlite-vec') as {
        load(database: Database.Database): void;
      };
      loadVectorExtension = (database) => vectorModule.load(database);
    } catch (error) {
      throw new Error(
        'SQLite caching requires the optional better-sqlite3 and sqlite-vec packages',
        { cause: error },
      );
    }
    if (options.filename !== ':memory:') {
      mkdirSync(dirname(resolve(options.filename)), { recursive: true });
    }
    this.#database = new DatabaseConstructor(options.filename);
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('foreign_keys = ON');
    loadVectorExtension(this.#database);
    this.#migrate();
  }

  get(
    vendorId: string,
    resource: string,
    key: string,
  ): Promise<DigikalaCacheEntry | null> {
    const row = this.#database
      .prepare(
        'SELECT value_json, fetched_at, expires_at FROM cache_entries WHERE vendor_id = ? AND resource = ? AND cache_key = ?',
      )
      .get(vendorId, resource, key) as CacheRow | undefined;
    return Promise.resolve(
      row
        ? {
            vendorId,
            resource,
            key,
            value: JSON.parse(row.value_json) as unknown,
            fetchedAt: row.fetched_at,
            expiresAt: row.expires_at,
          }
        : null,
    );
  }

  set(entry: DigikalaCacheEntry): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO cache_entries (vendor_id, resource, cache_key, value_json, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(vendor_id, resource, cache_key) DO UPDATE SET value_json=excluded.value_json, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`,
      )
      .run(
        entry.vendorId,
        entry.resource,
        entry.key,
        JSON.stringify(entry.value),
        entry.fetchedAt,
        entry.expiresAt,
      );
    return Promise.resolve();
  }

  invalidate(vendorId: string, resource?: string): Promise<number> {
    return Promise.resolve(
      this.#database.transaction(() => {
        const params = resource ? [vendorId, resource] : [vendorId];
        const suffix = resource ? ' AND resource = ?' : '';
        this.#database
          .prepare(
            `DELETE FROM semantic_embeddings WHERE vendor_id = ?${suffix}`,
          )
          .run(...params);
        this.#database
          .prepare(`DELETE FROM cached_entities WHERE vendor_id = ?${suffix}`)
          .run(...params);
        return this.#database
          .prepare(`DELETE FROM cache_entries WHERE vendor_id = ?${suffix}`)
          .run(...params).changes;
      })(),
    );
  }

  replaceSnapshot(
    vendorId: string,
    snapshot: DigikalaCacheSnapshot,
  ): Promise<void> {
    const replace = this.#database.transaction(() => {
      const deleteResource = this.#database.prepare(
        'DELETE FROM cached_entities WHERE vendor_id = ? AND resource = ?',
      );
      const deleteEmbeddings = this.#database.prepare(
        'DELETE FROM semantic_embeddings WHERE vendor_id = ? AND resource = ?',
      );
      const deleteEntries = this.#database.prepare(
        'DELETE FROM cache_entries WHERE vendor_id = ? AND resource = ?',
      );
      for (const resource of snapshot.resources) {
        deleteEmbeddings.run(vendorId, resource);
        deleteResource.run(vendorId, resource);
        deleteEntries.run(vendorId, resource);
      }
      const putEntry = this.#database
        .prepare(`INSERT INTO cache_entries (vendor_id, resource, cache_key, value_json, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(vendor_id, resource, cache_key) DO UPDATE SET value_json=excluded.value_json, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`);
      for (const entry of snapshot.entries)
        putEntry.run(
          entry.vendorId,
          entry.resource,
          entry.key,
          JSON.stringify(entry.value),
          entry.fetchedAt,
          entry.expiresAt,
        );
      const putEntity = this.#database.prepare(
        'INSERT INTO cached_entities (vendor_id, resource, entity_id, data_json, fetched_at) VALUES (?, ?, ?, ?, ?)',
      );
      for (const entity of snapshot.entities)
        putEntity.run(
          entity.vendorId,
          entity.resource,
          entity.id,
          JSON.stringify(entity.data),
          entity.fetchedAt,
        );
      const putEmbedding = this.#database.prepare(
        'INSERT INTO semantic_embeddings (vendor_id, resource, entity_id, source_hash, source_text, model, dimensions, embedding, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const item of snapshot.embeddings)
        putEmbedding.run(
          item.vendorId,
          item.resource,
          item.id,
          item.sourceHash,
          item.sourceText,
          item.model,
          item.dimensions,
          new Float32Array(item.embedding),
          item.generatedAt,
        );
    });
    replace();
    return Promise.resolve();
  }

  search(input: {
    vendorId: string;
    model: string;
    dimensions: number;
    embedding: readonly number[];
    resources?: readonly ('products' | 'variants')[];
    limit: number;
  }): Promise<DigikalaSemanticMatch[]> {
    if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 100)
      throw new TypeError('Semantic search limit must be between 1 and 100');
    const resources = input.resources?.length
      ? [...input.resources]
      : ['products', 'variants'];
    const placeholders = resources.map(() => '?').join(',');
    const rows = this.#database
      .prepare(
        `SELECT e.resource, e.entity_id, e.data_json,
      vec_distance_cosine(s.embedding, ?) AS distance
      FROM semantic_embeddings s JOIN cached_entities e
      ON e.vendor_id=s.vendor_id AND e.resource=s.resource AND e.entity_id=s.entity_id
      WHERE s.vendor_id=? AND s.model=? AND s.dimensions=? AND s.resource IN (${placeholders})
      ORDER BY distance ASC LIMIT ?`,
      )
      .all(
        new Float32Array(input.embedding),
        input.vendorId,
        input.model,
        input.dimensions,
        ...resources,
        input.limit,
      ) as SearchRow[];
    return Promise.resolve(
      rows.map((row) => ({
        resource: row.resource,
        id: row.entity_id,
        score: 1 - row.distance,
        data: JSON.parse(row.data_json) as unknown,
      })),
    );
  }

  close(): void {
    this.#database.close();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        vendor_id TEXT NOT NULL, resource TEXT NOT NULL, cache_key TEXT NOT NULL,
        value_json TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        PRIMARY KEY (vendor_id, resource, cache_key)
      );
      CREATE TABLE IF NOT EXISTS cached_entities (
        vendor_id TEXT NOT NULL, resource TEXT NOT NULL, entity_id TEXT NOT NULL,
        data_json TEXT NOT NULL, fetched_at TEXT NOT NULL,
        PRIMARY KEY (vendor_id, resource, entity_id)
      );
      CREATE TABLE IF NOT EXISTS semantic_embeddings (
        vendor_id TEXT NOT NULL, resource TEXT NOT NULL, entity_id TEXT NOT NULL,
        source_hash TEXT NOT NULL, source_text TEXT NOT NULL, model TEXT NOT NULL,
        dimensions INTEGER NOT NULL, embedding BLOB NOT NULL, generated_at TEXT NOT NULL,
        PRIMARY KEY (vendor_id, resource, entity_id, model)
      );
      CREATE INDEX IF NOT EXISTS semantic_lookup ON semantic_embeddings(vendor_id, model, dimensions, resource);
    `);
  }
}
