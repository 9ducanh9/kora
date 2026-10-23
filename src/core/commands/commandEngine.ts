import { Command } from './types';
import { DiagramDocument, createEmptyDiagramDocument } from '../diagram/types';
import { validateDiagramDocument } from '../diagram/validator';
import { formatValidationIssues } from '../validation/issues';

export interface DocumentChangeEvent {
  kind: 'edit' | 'replacement';
  operation: 'dispatch' | 'undo' | 'redo' | 'reset';
  revision: number;
}

export class CommandEngine {
  private document: DiagramDocument;
  private history: Command[] = [];
  private cursor = -1;
  private listeners: Set<(doc: DiagramDocument, change: DocumentChangeEvent) => void> = new Set();
  private maxHistory = 50;
  private revisionValue = 0;

  constructor(initialDoc?: DiagramDocument) {
    this.document = initialDoc || createEmptyDiagramDocument();
  }

  getDocument(): DiagramDocument {
    return this.document;
  }

  get canUndo(): boolean {
    return this.cursor >= 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.history.length - 1;
  }

  get revision(): number {
    return this.revisionValue;
  }

  dispatch(command: Command): boolean {
    const nextDoc = command.execute(this.document);
    if (nextDoc === this.document) return false;
    const validation = validateDiagramDocument(nextDoc);
    if (!validation.ok) throw new Error(`Command produced an invalid document:\n${formatValidationIssues(validation.issues)}`);
    this.document = nextDoc;

    // Truncate any redo history
    this.history = this.history.slice(0, this.cursor + 1);
    this.history.push(command);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.cursor++;
    }

    this.revisionValue++;
    this.notify(command.documentChangeKind ?? 'edit', 'dispatch');
    return true;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const command = this.history[this.cursor];
    const previous = command.undo(this.document);
    const validation = validateDiagramDocument(previous);
    if (!validation.ok) throw new Error(`Undo produced an invalid document:\n${formatValidationIssues(validation.issues)}`);
    this.document = previous;
    this.cursor--;
    this.revisionValue++;
    this.notify(command.documentChangeKind ?? 'edit', 'undo');
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.cursor++;
    const command = this.history[this.cursor];
    const next = command.execute(this.document);
    const validation = validateDiagramDocument(next);
    if (!validation.ok) {
      this.cursor--;
      throw new Error(`Redo produced an invalid document:\n${formatValidationIssues(validation.issues)}`);
    }
    this.document = next;
    this.revisionValue++;
    this.notify(command.documentChangeKind ?? 'edit', 'redo');
    return true;
  }

  reset(newDoc: DiagramDocument) {
    const validation = validateDiagramDocument(newDoc);
    if (!validation.ok) throw new Error(`Reset received an invalid document:\n${formatValidationIssues(validation.issues)}`);
    this.document = newDoc;
    this.history = [];
    this.cursor = -1;
    this.revisionValue++;
    this.notify('replacement', 'reset');
  }

  subscribe(listener: (doc: DiagramDocument, change: DocumentChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(kind: DocumentChangeEvent['kind'], operation: DocumentChangeEvent['operation']) {
    const change = { kind, operation, revision: this.revisionValue } satisfies DocumentChangeEvent;
    for (const listener of this.listeners) {
      listener(this.document, change);
    }
  }
}
