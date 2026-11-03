import type { DigikalaEmbeddingProvider } from './types.js';

export class TransformersJsEmbeddingProvider implements DigikalaEmbeddingProvider {
  readonly model: string;
  readonly #pipelineOptions: Record<string, unknown>;
  #extractor?: Promise<
    (
      texts: string[],
      options: Record<string, unknown>,
    ) => Promise<{ tolist(): number[][] }>
  >;

  constructor(
    options: { model?: string; pipelineOptions?: Record<string, unknown> } = {},
  ) {
    this.model = options.model ?? 'Xenova/multilingual-e5-small';
    this.#pipelineOptions = options.pipelineOptions ?? {};
  }

  async embed(
    texts: readonly string[],
    kind: 'document' | 'query',
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const extractor = await this.#getExtractor();
    const prefix = kind === 'query' ? 'query: ' : 'passage: ';
    const output = await extractor(
      texts.map((text) => `${prefix}${text}`),
      { pooling: 'mean', normalize: true },
    );
    return output.tolist();
  }

  async #getExtractor() {
    this.#extractor ??= import('@huggingface/transformers').then(
      async ({ pipeline }) => {
        const extractor = await pipeline(
          'feature-extraction',
          this.model,
          this.#pipelineOptions,
        );
        return extractor;
      },
    );
    return this.#extractor;
  }
}
