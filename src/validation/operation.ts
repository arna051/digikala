import type { z } from 'zod';
import {
  DigikalaRequestValidationError,
  DigikalaResponseValidationError,
} from './errors.js';

export interface ValidatedOperationOptions<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> {
  input: TInputSchema;
  output: TOutputSchema;
  execute(input: z.output<TInputSchema>): Promise<unknown>;
}

/** Builds an operation that cannot execute transport before input validation. */
export function createValidatedOperation<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(options: ValidatedOperationOptions<TInputSchema, TOutputSchema>) {
  return async (
    input: z.input<TInputSchema>,
  ): Promise<z.output<TOutputSchema>> => {
    const parsedInput = options.input.safeParse(input);
    if (!parsedInput.success) {
      throw new DigikalaRequestValidationError(parsedInput.error);
    }

    const response = await options.execute(parsedInput.data);
    const parsedOutput = options.output.safeParse(response);
    if (!parsedOutput.success) {
      throw new DigikalaResponseValidationError(parsedOutput.error);
    }
    return parsedOutput.data;
  };
}
