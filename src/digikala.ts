import { DEFAULT_OPTIONS } from './config/defaults.js';
import type {
  DigikalaClientOptions,
  ResolvedDigikalaClientOptions,
} from './types/index.js';

/**
 * Root SDK client. Resource and authentication modules are added in later
 * goals; this class owns the stable, runtime-neutral configuration boundary.
 */
export class Digikala {
  readonly options: Readonly<ResolvedDigikalaClientOptions>;

  constructor(options: DigikalaClientOptions = {}) {
    this.options = Object.freeze({ ...DEFAULT_OPTIONS, ...options });
  }
}
