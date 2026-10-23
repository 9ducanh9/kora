export interface OperationTicket {
  id: number;
  revision: number;
  epoch: number;
}

export type OperationState = 'current' | 'superseded' | 'stale';

/** A single latest-operation token shared by Generate, Load, Import and layout. */
export class OperationCoordinator {
  private sequence = 0;
  private owner: number | null = null;
  private cancelOwner: ((reason: string) => void) | undefined;

  begin(revision: number, epoch = 0): OperationTicket {
    this.cancelOwner?.('superseded');
    this.cancelOwner = undefined;
    const id = ++this.sequence;
    this.owner = id;
    return { id, revision, epoch };
  }

  inspect(ticket: OperationTicket, currentRevision: number, currentEpoch = ticket.epoch): OperationState {
    if (this.owner !== ticket.id) return 'superseded';
    if (ticket.revision !== currentRevision || ticket.epoch !== currentEpoch) return 'stale';
    return 'current';
  }

  registerCancellation(ticket: OperationTicket, cancel: (reason: string) => void): () => void {
    if (this.owner !== ticket.id) return () => undefined;
    this.cancelOwner = cancel;
    return () => { if (this.owner === ticket.id && this.cancelOwner === cancel) this.cancelOwner = undefined; };
  }

  finish(ticket: OperationTicket): boolean {
    if (this.owner !== ticket.id) return false;
    this.owner = null;
    this.cancelOwner = undefined;
    return true;
  }

  invalidate(): void {
    this.cancelOwner?.('invalidated');
    this.cancelOwner = undefined;
    this.sequence++;
    this.owner = null;
  }
}
