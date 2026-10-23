import { DiagramDocument } from './types';
import { decodeDiagramDocument, validateDiagramDocument } from './validator';
import { ValidationIssue, ValidationResult } from '../validation/issues';
import { startDiagramDownload } from '../export/download';

export const DIAGRAM_STORAGE_KEY = 'kora:diagram:v1';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readDiagramStorageValue(adapter?: StorageAdapter): string | null | undefined {
  try {
    const storage = adapter ?? browserStorage();
    return storage ? storage.getItem(DIAGRAM_STORAGE_KEY) : undefined;
  } catch {
    return undefined;
  }
}

export type LoadDiagramResult =
  | { status: 'missing' }
  | { status: 'loaded'; document: DiagramDocument; issues: ValidationIssue[] }
  | { status: 'invalid'; raw: string; issues: ValidationIssue[] }
  | { status: 'unavailable'; issues: ValidationIssue[] };

export type SaveDiagramResult =
  | { ok: true; issues: ValidationIssue[] }
  | { ok: false; reason: 'validation' | 'serialization' | 'unavailable'; issues: ValidationIssue[] };

function browserStorage(): StorageAdapter | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

export function loadDiagramFromStorage(adapter?: StorageAdapter): LoadDiagramResult {
  let storage: StorageAdapter | undefined;
  let raw: string | null;
  try {
    storage = adapter ?? browserStorage();
    if (!storage) return { status: 'unavailable', issues: [{ code: 'STORAGE_UNAVAILABLE', severity: 'warning', path: [], message: 'Browser storage is not available in this environment.' }] };
    raw = storage.getItem(DIAGRAM_STORAGE_KEY);
  } catch {
    return { status: 'unavailable', issues: [{ code: 'STORAGE_READ_FAILED', severity: 'warning', path: [], message: 'The saved diagram could not be read from browser storage.' }] };
  }
  if (raw === null) return { status: 'missing' };

  const decoded = decodeDiagramDocument(raw);
  return decoded.ok
    ? { status: 'loaded', document: decoded.value, issues: decoded.issues }
    : { status: 'invalid', raw, issues: decoded.issues };
}

export function saveDiagramToStorage(doc: unknown, adapter?: StorageAdapter): SaveDiagramResult {
  const validated = validateForSave(doc);
  if (!validated.ok) return { ok: false, reason: 'validation', issues: validated.issues };

  let serialized: string;
  try {
    serialized = JSON.stringify(validated.value);
  } catch {
    return { ok: false, reason: 'serialization', issues: [{ code: 'DOCUMENT_SERIALIZE_FAILED', severity: 'error', path: [], message: 'The diagram could not be serialized.' }] };
  }

  try {
    const storage = adapter ?? browserStorage();
    if (!storage) return { ok: false, reason: 'unavailable', issues: [{ code: 'STORAGE_UNAVAILABLE', severity: 'warning', path: [], message: 'Browser storage is not available in this environment.' }] };
    storage.setItem(DIAGRAM_STORAGE_KEY, serialized);
    return { ok: true, issues: validated.issues };
  } catch {
    return { ok: false, reason: 'unavailable', issues: [{ code: 'STORAGE_WRITE_FAILED', severity: 'error', path: [], message: 'The diagram could not be saved to browser storage.' }] };
  }
}

function validateForSave(raw: unknown): ValidationResult<DiagramDocument> {
  return validateDiagramDocument(raw);
}

export type ExportDiagramResult =
  | { ok: true; issues: ValidationIssue[] }
  | { ok: false; reason: 'validation' | 'serialization' | 'unavailable'; issues: ValidationIssue[] };

export function exportDiagramToFile(raw: unknown): ExportDiagramResult {
  const validated = validateDiagramDocument(raw);
  if (!validated.ok) return { ok: false, reason: 'validation', issues: validated.issues };
  let json: string;
  try {
    json = JSON.stringify(validated.value, null, 2);
  } catch {
    return { ok: false, reason: 'serialization', issues: [{ code: 'DOCUMENT_SERIALIZE_FAILED', severity: 'error', path: [], message: 'The diagram could not be serialized for export.' }] };
  }
  try {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    startDiagramDownload(blob, validated.value.metadata.title, 'json');
    return { ok: true, issues: validated.issues };
  } catch {
    return { ok: false, reason: 'unavailable', issues: [{ code: 'DOWNLOAD_START_FAILED', severity: 'error', path: [], message: 'The diagram download could not be started.' }] };
  }
}

export function importDiagramFromJson(jsonStr: string): ValidationResult<DiagramDocument> {
  return decodeDiagramDocument(jsonStr);
}
