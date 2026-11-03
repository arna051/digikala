export type DigikalaRuntime = 'universal' | 'browser' | 'node';

/** Runtime-neutral options shared by all Digikala clients. */
export interface DigikalaClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export type ResolvedDigikalaClientOptions = Required<DigikalaClientOptions>;
