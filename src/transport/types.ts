import type {
  AxiosAdapter,
  Method,
  RawAxiosRequestHeaders,
  ResponseType,
} from 'axios';
import type { z } from 'zod';

export interface DigikalaTransportCredentials {
  accessToken: string;
  sellerCode: string;
}

export type DigikalaCredentialResolver = () =>
  DigikalaTransportCredentials | Promise<DigikalaTransportCredentials>;

export interface DigikalaTransportRequestMetadata {
  method: string;
  path: string;
  timeoutMs: number;
}

export interface DigikalaTransportResponseMetadata extends DigikalaTransportRequestMetadata {
  status: number;
  durationMs: number;
}

export interface DigikalaTransportHooks {
  beforeRequest?(
    metadata: DigikalaTransportRequestMetadata,
  ): void | Promise<void>;
  afterResponse?(
    metadata: DigikalaTransportResponseMetadata,
  ): void | Promise<void>;
  onError?(
    error: Error,
    metadata: DigikalaTransportRequestMetadata,
  ): void | Promise<void>;
}

export interface DigikalaAxiosTransportOptions {
  credentials: DigikalaCredentialResolver;
  /** Refresh credentials after a 401. Return true to retry exactly once. */
  onUnauthorized?: (
    rejectedCredentials: DigikalaTransportCredentials,
  ) => boolean | Promise<boolean>;
  timeoutMs?: number;
  baseUrl?: string;
  adapter?: AxiosAdapter;
  hooks?: DigikalaTransportHooks;
  /**
   * Seller-wide read pacing. Custom Axios adapters default to disabled so test
   * adapters do not inherit production delays.
   */
  rateLimit?:
    | false
    | {
        readGapMs?: number;
        variantsReadGapMs?: number;
        retry429?: boolean;
      };
}

export interface SerializedDigikalaRequest {
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: RawAxiosRequestHeaders;
}

export interface DigikalaTransportRequest<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> {
  method: Method;
  path: string;
  input: z.input<TInputSchema>;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  serialize(input: z.output<TInputSchema>): SerializedDigikalaRequest;
  responseType?: ResponseType;
  signal?: AbortSignal;
  timeoutMs?: number;
}
