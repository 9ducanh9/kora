import { DiagramDocument } from '../diagram/types';
import {
  LoadDiagramResult,
  SaveDiagramResult,
  StorageAdapter,
  loadDiagramFromStorage,
  readDiagramStorageValue,
  saveDiagramToStorage
} from '../diagram/storage';

export type PersistenceState = 'loading' | 'new' | 'clean' | 'dirty' | 'saving' | 'error' | 'paused';

export interface PersistenceStatus {
  state: PersistenceState;
  dirty: boolean;
  reason?: string;
  lastSavedAt?: string;
}

type ScheduleTimer = (callback: () => void, timeout: number) => ReturnType<typeof setTimeout>;
type CancelTimer = (timer: ReturnType<typeof setTimeout>) => void;

export interface PersistenceCoordinatorOptions {
  adapter?: StorageAdapter;
  onStatus?: (status: PersistenceStatus) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  setTimer?: ScheduleTimer;
  clearTimer?: CancelTimer;
  now?: () => Date;
}

function fingerprint(document: DiagramDocument): string {
  const { updatedAt: _updatedAt, ...metadata } = document.metadata;
  return JSON.stringify({
    version: document.version,
    semantic: document.semantic,
    presentation: document.presentation,
    metadata
  });
}

function cloneDocument(document: DiagramDocument): DiagramDocument {
  return JSON.parse(JSON.stringify(document)) as DiagramDocument;
}

/** Single owner for local persistence scheduling and its trust baseline. */
export class PersistenceCoordinator {
  private readonly adapter?: StorageAdapter;
  private readonly onStatus?: (status: PersistenceStatus) => void;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly setTimer: ScheduleTimer;
  private readonly clearTimer: CancelTimer;
  private readonly now: () => Date;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private hydrated = false;
  private baselineFingerprint: string | undefined;
  private baselineRaw: string | null | undefined;
  private initialFingerprint = '';
  private current: DiagramDocument | undefined;
  private currentRevision = 0;
  private currentEpoch = 0;
  private status: PersistenceStatus = { state: 'loading', dirty: false };
  private disposed = false;

  constructor(options: PersistenceCoordinatorOptions = {}) {
    this.adapter = options.adapter;
    this.onStatus = options.onStatus;
    this.debounceMs = options.debounceMs ?? 600;
    this.maxWaitMs = options.maxWaitMs ?? 3000;
    // Browser timer functions require the Window receiver. Calling a captured
    // native function as this.setTimer() otherwise throws Illegal invocation.
    this.setTimer = options.setTimer ?? ((callback, timeout) => setTimeout(callback, timeout));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.now = options.now ?? (() => new Date());
  }

  getStatus(): PersistenceStatus { return { ...this.status }; }

  hydrate(initialDocument: DiagramDocument): LoadDiagramResult {
    this.disposed = false;
    const result = loadDiagramFromStorage(this.adapter);
    this.hydrated = true;
    this.initialFingerprint = fingerprint(initialDocument);
    this.current = initialDocument;
    this.currentRevision = 0;
    if (result.status === 'loaded') {
      this.establishBaseline(result.document);
    } else if (result.status === 'missing') {
      this.baselineFingerprint = undefined;
      this.baselineRaw = null;
      this.publish({ state: 'new', dirty: false });
    } else {
      this.baselineFingerprint = undefined;
      this.baselineRaw = result.status === 'invalid' ? result.raw : undefined;
      this.publish({ state: 'paused', dirty: false, reason: result.status === 'invalid' ? 'invalid-saved-data' : 'storage-read-unavailable' });
    }
    return result;
  }

  acceptLoadedDocument(document: DiagramDocument): void {
    this.cancelTimers();
    this.current = cloneDocument(document);
    this.initialFingerprint = fingerprint(document);
    this.establishBaseline(document);
  }

  pause(reason: string): void {
    this.cancelTimers();
    this.publish({ state: 'paused', dirty: this.isDirty(), reason, lastSavedAt: this.status.lastSavedAt });
  }

  observe(document: DiagramDocument, revision: number, epoch: number, committed = true): void {
    this.current = cloneDocument(document);
    this.currentRevision = revision;
    this.currentEpoch = epoch;
    if (!this.hydrated || this.disposed || !committed) return;
    const dirty = this.isDirty();
    if (!dirty) {
      this.cancelTimers();
      const cleanState = this.status.state === 'paused' || this.status.state === 'error'
        ? this.status.state
        : this.baselineFingerprint === undefined ? 'new' : 'clean';
      this.publish({ state: cleanState, dirty: false, reason: this.status.reason, lastSavedAt: this.status.lastSavedAt });
      return;
    }
    if (this.status.state === 'paused' || this.status.state === 'error') {
      this.publish({ ...this.status, dirty: true });
      return;
    }
    this.publish({ state: 'dirty', dirty: true, lastSavedAt: this.status.lastSavedAt });
    if (!this.debounceTimer) this.maxWaitTimer = this.setTimer(() => { void this.flush(); }, this.maxWaitMs);
    if (this.debounceTimer) this.clearTimer(this.debounceTimer);
    this.debounceTimer = this.setTimer(() => { void this.flush(); }, this.debounceMs);
  }

  flush(): SaveDiagramResult | undefined {
    if (!this.current || !this.hydrated || this.disposed) return undefined;
    return this.saveSnapshot(this.current, false);
  }

  saveExplicit(document: DiagramDocument = this.current as DiagramDocument): SaveDiagramResult | undefined {
    if (!document || !this.hydrated || this.disposed) return undefined;
    this.current = cloneDocument(document);
    return this.saveSnapshot(this.current, true);
  }

  handleExternalStorageChange(rawValue: string | null | undefined): boolean {
    if (rawValue === this.baselineRaw) return false;
    this.pause('external-storage-change');
    return true;
  }

  onVisibilityHidden(): void {
    if (this.status.state !== 'paused' && this.status.state !== 'error' && this.isDirty()) this.flush();
  }

  dispose(): void {
    if (this.status.state !== 'paused' && this.status.state !== 'error' && this.isDirty()) this.flush();
    this.disposed = true;
    this.cancelTimers();
  }

  private saveSnapshot(document: DiagramDocument, explicit: boolean): SaveDiagramResult {
    const id = fingerprint(document);
    const currentRaw = readDiagramStorageValue(this.adapter);
    const baselineTrusted = this.baselineRaw !== undefined && currentRaw === this.baselineRaw;
    if (!explicit && (this.status.state === 'paused' || this.status.state === 'error')) return { ok: false, reason: 'unavailable', issues: [] };
    if (!explicit && this.baselineRaw !== undefined && !baselineTrusted) {
      this.pause('external-storage-change');
      return { ok: false, reason: 'unavailable', issues: [] };
    }
    if (id === this.baselineFingerprint && baselineTrusted) {
      this.cancelTimers();
      this.publish({ state: 'clean', dirty: false, lastSavedAt: this.status.lastSavedAt });
      return { ok: true, issues: [] };
    }
    this.cancelTimers();
    this.publish({ state: 'saving', dirty: true, lastSavedAt: this.status.lastSavedAt });
    const result = saveDiagramToStorage(document, this.adapter);
    if (!result.ok) {
      this.publish({ state: 'error', dirty: true, reason: result.reason, lastSavedAt: this.status.lastSavedAt });
      return result;
    }
    this.baselineFingerprint = id;
    this.baselineRaw = readDiagramStorageValue(this.adapter);
    const savedAt = this.now().toISOString();
    this.publish({ state: 'clean', dirty: false, lastSavedAt: savedAt });
    return result;
  }

  private establishBaseline(document: DiagramDocument): void {
    this.current = cloneDocument(document);
    this.baselineFingerprint = fingerprint(document);
    this.baselineRaw = readDiagramStorageValue(this.adapter);
    this.cancelTimers();
    this.publish({ state: 'clean', dirty: false });
  }

  private isDirty(): boolean {
    return Boolean(this.current && fingerprint(this.current) !== (this.baselineFingerprint ?? this.initialFingerprint));
  }

  private publish(status: PersistenceStatus): void {
    this.status = status;
    this.onStatus?.({ ...status });
  }

  private cancelTimers(): void {
    if (this.debounceTimer) this.clearTimer(this.debounceTimer);
    if (this.maxWaitTimer) this.clearTimer(this.maxWaitTimer);
    this.debounceTimer = undefined;
    this.maxWaitTimer = undefined;
  }
}
