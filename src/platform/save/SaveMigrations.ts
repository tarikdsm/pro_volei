import {
  createDefaultSave,
  normalizeSaveV1,
  SAVE_VERSION,
  type ProVoleiSaveV1,
} from './SaveSchema';

/** Migra documentos conhecidos sem efeitos colaterais; entrada pode ser JSON serializado. */
export function migrateSave(value: unknown): Readonly<ProVoleiSaveV1> {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return createDefaultSave();
    }
  }
  if (!isRecord(parsed)) return createDefaultSave();
  const version = parsed.version;
  if (version === undefined || version === 0 || version === SAVE_VERSION) {
    return normalizeSaveV1(parsed);
  }
  return createDefaultSave();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
