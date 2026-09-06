/**
 * The storage abstraction's provider-facing contract.
 *
 * Everything above this file (route handlers, src/lib/storage/answerSheets.ts)
 * talks to files only through this interface — never through a specific
 * provider's SDK. Swapping the local filesystem driver (see
 * localFileStorage.ts) for a cloud provider later means implementing this
 * interface once, with zero changes to any caller.
 *
 * Deliberately minimal: write/read/remove by opaque key. No listing, no
 * metadata, no URLs — those concerns belong to the database (AnswerSheetPage)
 * and to whichever access mechanism a provider supports (signed URL vs.
 * server-side streaming), not to this interface.
 */
export interface FileStorageDriver {
  /**
   * Writes bytes under `key`, creating any needed parent structure.
   * Callers are responsible for key uniqueness — this may overwrite an
   * existing object at the same key.
   */
  write(key: string, data: Buffer): Promise<void>;

  /** Reads bytes back, or `null` if nothing exists at `key`. */
  read(key: string): Promise<Buffer | null>;

  /**
   * Removes the object at `key`. Never throws solely because the key is
   * already gone — deletion is used as best-effort compensation logic
   * (e.g. after a failed database write), so a missing file there is a
   * success, not an error.
   */
  remove(key: string): Promise<void>;
}
