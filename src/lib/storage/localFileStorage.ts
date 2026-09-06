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
 * handler (see src/app/api/*\/answer-sheets/[pageId]/route.ts) that checks
 * Submission ownership before this driver is ever touched.
 */

// A fully static path (no env-derived segment) is intentional: Next.js's
// build-time file tracing can only scope a filesystem-access root it can
// statically analyze. A dynamic path here (e.g. from an env var) makes
// Turbopack fall back to tracing the entire project into the server output,
// which was confirmed by an actual production build during this phase.
const STORAGE_ROOT = path.join(process.cwd(), "storage", "answer-sheets");

/**
 * Resolves `key` to an absolute path and verifies it stays inside
 * STORAGE_ROOT. Keys are always server-generated (see answerSheets.ts) and
 * never taken verbatim from user input, but this check costs nothing and
 * removes any reliance on that being true forever.
 */
function resolveSafePath(key: string): string {
  const resolved = path.resolve(STORAGE_ROOT, key);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Refusing to access a storage key outside the storage root.");
  }
  return resolved;
}

class LocalFileStorage implements FileStorageDriver {
  async write(key: string, data: Buffer): Promise<void> {
    const target = resolveSafePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(resolveSafePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(resolveSafePath(key), { force: true });
  }
}

export const localFileStorage: FileStorageDriver = new LocalFileStorage();
