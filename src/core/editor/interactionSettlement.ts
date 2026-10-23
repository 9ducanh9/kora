import { DiagramExportError } from '../export/limits';

export type InteractionCommit = (signal: AbortSignal) => Promise<void> | void;
export type InteractionCancel = () => void;
interface ActiveInteraction { commit: InteractionCommit; cancel?: InteractionCancel }
const active = new Map<string, ActiveInteraction>();
const previews = new Map<string, InteractionCancel>();

export function registerActiveInteraction(id: string, commit: InteractionCommit, cancel?: InteractionCancel): () => void {
  const interaction = { commit, cancel };
  active.set(id, interaction);
  return () => { if (active.get(id) === interaction) active.delete(id); };
}

/** Register transient canvas state that snapshot or replacement intents must discard. */
export function registerCancellablePreview(id: string, cancel: InteractionCancel): () => void {
  previews.set(id, cancel);
  return () => { if (previews.get(id) === cancel) previews.delete(id); };
}

function cancelPreviews(): void {
  for (const cancel of [...previews.values()]) {
    cancel();
  }
}

/** Cancel inline drafts and transient previews before a replacement or edit intent. */
export function cancelActiveInteractions(): void {
  for (const [id, interaction] of [...active]) {
    active.delete(id);
    interaction.cancel?.();
  }
  cancelPreviews();
}

export async function awaitInteraction<T>(value: Promise<T>, signal?: AbortSignal, timeoutMs = 5_000): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(signal?.reason ?? new DOMException('Label edit cancelled.', 'AbortError'));
  signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DiagramExportError('SETTLEMENT_TIMEOUT', 'Could not finish the active label edit within 5 seconds. The edit is still open.')), timeoutMs);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason ?? new DOMException('Label edit cancelled.', 'AbortError'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  try {
    if (signal?.aborted) onParentAbort();
    return await Promise.race([value, aborted]);
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

/** Commit active inline labels once before a snapshot action, with a bounded font wait. */
export async function settleActiveInteractions(timeoutMs = 5_000, parentSignal?: AbortSignal): Promise<void> {
  if (active.size === 0) { cancelPreviews(); return; }
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason ?? new DOMException('Action cancelled.', 'AbortError'));
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DiagramExportError('SETTLEMENT_TIMEOUT', 'Could not finish the active label edit within 5 seconds. The edit is still open.')), timeoutMs);
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason ?? new DOMException('Action cancelled.', 'AbortError'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    if (parentSignal?.aborted) onParentAbort();
    const commits = [...active.values()].map(interaction => Promise.resolve().then(() => interaction.commit(controller.signal)));
    await Promise.race([Promise.all(commits), aborted]);
    cancelPreviews();
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
