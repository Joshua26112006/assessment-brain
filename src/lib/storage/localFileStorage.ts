import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorageDriver } from "./types";

/**
 * Local-filesystem implementation of FileStorageDriver.
 *
 * Provider choice for this phase: the project has no cloud storage
 * dependency, no storage-provider environment variable, and no deployment
 * configuration committed anywhere in the repository (verified by
 * inspection — see the Phase 3.1 report). Introducing a cloud SDK here
 * would mean guessing at credentials and a provider nobody has configured.
 * The local filesystem needs zero new packages and zero new secrets, and
 * everything above this file talks only to the FileStorageDriver interface
 * — so replacing this with S3/Vercel Blob/Supabase Storage later is a
 * single new file, not a rewrite.
 *
 * Files are rooted OUTSIDE `public/` specifically so nothing here is ever
 * statically servable — every read goes through an authorized route
 * handler (see src/app/api/*\/answer-sheets/[pageId]/route.ts and
 * src/app/api/teacher/assessments/[id]/question-paper/*) that checks
 * ownership before this driver is ever touched.
 */

// A fully static base path (no env-derived segment) is intentional: Next.js's
// build-time file tracing can only scope a filesystem-access root it can
// statically analyze. A dynamic path here (e.g. from an env var) makes
// Turbopack fall back to tracing the entire project into the server output,
// which was confirmed by an actual production build during Phase 3.1.
const BASE_STORAGE_ROOT = path.join(process.cwd(), "storage");

/**
 * Builds one namespaced local-filesystem FileStorageDriver rooted at
 * storage/<namespace>/ (e.g. "answer-sheets", "question-papers").
 *
 * Extracted (Phase 3.3) from what was a single hardcoded answer-sheets
 * driver so a second private file type (question papers) can reuse the
 * exact same write/read/remove/path-safety implementation without a second
 * copy of it — every namespace still only ever talks through the same
 * FileStorageDriver interface, so this remains a single swap point for a
 * future cloud provider, not two.
 */
export function createLocalFileStorage(namespace: string): FileStorageDriver {
  const root = path.join(BASE_STORAGE_ROOT, namespace);

  /**
   * Resolves `key` to an absolute path and verifies it stays inside this
   * namespace's root. Keys are always server-generated (see
   * answerSheets.ts / questionPapers.ts) and never taken verbatim from user
   * input, but this check costs nothing and removes any reliance on that
   * being true forever.
   */
  function resolveSafePath(key: string): string {
    const resolved = path.resolve(root, key);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error("Refusing to access a storage key outside the storage root.");
    }
    return resolved;
  }

  return {
    async write(key: string, data: Buffer): Promise<void> {
      const target = resolveSafePath(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    },

    async read(key: string): Promise<Buffer | null> {
      try {
        return await readFile(resolveSafePath(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async remove(key: string): Promise<void> {
      await rm(resolveSafePath(key), { force: true });
    },
  };
}

/**
 * The original Phase 3.1 singleton — same namespace ("answer-sheets"), same
 * root, same behavior as before this refactor. Every existing storageKey
 * already on disk resolves identically through this instance.
 */
export const localFileStorage: FileStorageDriver = createLocalFileStorage("answer-sheets");
