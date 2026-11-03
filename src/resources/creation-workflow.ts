import {
  CreationWorkflowStateSchema,
  type CreationWorkflowState,
} from './creation-schemas.js';

export type CreationWorkflowEvent =
  | { type: 'product_selected'; productId: number }
  | { type: 'details_validated'; draftProductId: number }
  | { type: 'attributes_validated' }
  | { type: 'images_uploaded' }
  | { type: 'product_submitted'; productId?: number }
  | { type: 'product_approved'; productId: number }
  | { type: 'variant_created'; variantId: number }
  | { type: 'needs_input'; fields: string[] }
  | { type: 'failed'; message: string };

export function createCreationWorkflow(input: {
  vendorId: string;
  mode: CreationWorkflowState['mode'];
  now?: Date;
}): CreationWorkflowState {
  const now = (input.now ?? new Date()).toISOString();
  return CreationWorkflowStateSchema.parse({
    id: crypto.randomUUID(),
    vendorId: input.vendorId,
    mode: input.mode,
    status: 'searching',
    completedSteps: [],
    pendingFields: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function advanceCreationWorkflow(
  current: CreationWorkflowState,
  event: CreationWorkflowEvent,
  now = new Date(),
): CreationWorkflowState {
  const state = CreationWorkflowStateSchema.parse(current);
  const completed = new Set(state.completedSteps);
  const next: CreationWorkflowState = {
    ...state,
    pendingFields: [],
    lastError: undefined,
    updatedAt: now.toISOString(),
  };
  switch (event.type) {
    case 'product_selected':
      completed.add('product_selected');
      Object.assign(next, {
        productId: event.productId,
        status: 'ready_for_variant',
      });
      break;
    case 'details_validated':
      completed.add('details_validated');
      Object.assign(next, {
        draftProductId: event.draftProductId,
        status: 'collecting_attributes',
      });
      break;
    case 'attributes_validated':
      completed.add('attributes_validated');
      next.status = 'collecting_images';
      break;
    case 'images_uploaded':
      completed.add('images_uploaded');
      next.status = 'collecting_images';
      break;
    case 'product_submitted':
      completed.add('product_submitted');
      if (event.productId) next.productId = event.productId;
      next.status = 'pending_moderation';
      break;
    case 'product_approved':
      completed.add('product_approved');
      next.productId = event.productId;
      next.status = 'ready_for_variant';
      break;
    case 'variant_created':
      completed.add('variant_created');
      next.variantId = event.variantId;
      next.status = 'completed';
      break;
    case 'needs_input':
      next.pendingFields = [...new Set(event.fields)];
      break;
    case 'failed':
      next.status = 'failed';
      next.lastError = event.message;
      break;
  }
  next.completedSteps = [...completed];
  return CreationWorkflowStateSchema.parse(next);
}
