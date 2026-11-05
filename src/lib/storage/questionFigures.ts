import crypto from "node:crypto";
import sharp from "sharp";
import { createLocalFileStorage } from "./localFileStorage";
import { detectImageMimeType } from "./fileSignatures";

/**
 * Files for question figures and model diagrams, under storage/question-figures/. Everything is stored as a PNG, whatever
 * was uploaded: a camera photo's embedded metadata (location, device) is dropped, an orientation tag is applied, and a
 * huge image is reduced to a size a model and a screen can use.
 */

const storage = createLocalFileStorage("question-figures");

export const MAX_FIGURE_UPLOAD_BYTES = 8 * 1024 * 1024;
/** The longest side of a stored figure, in pixels. */
export const MAX_FIGURE_SIDE = 2400;

export function newFigureKey(assessmentId: string): string {
  return `${assessmentId}/${crypto.randomUUID()}.png`;
}

export async function writeFigureFile(key: string, buffer: Buffer): Promise<void> {
  await storage.write(key, buffer);
}

export async function readFigureFile(key: string): Promise<Buffer | null> {
  return storage.read(key);
}

export async function removeFigureFile(key: string): Promise<void> {
  await storage.remove(key).catch(() => {});
}

export type PreparedUpload =
  | { ok: true; png: Buffer; widthPx: number; heightPx: number }
  | { ok: false; message: string };

/** Checks an uploaded picture by its real bytes and turns it into the PNG that is stored. */
export async function prepareFigureUpload(buffer: Buffer): Promise<PreparedUpload> {
  if (buffer.length === 0) return { ok: false, message: "That file is empty." };
  if (buffer.length > MAX_FIGURE_UPLOAD_BYTES) return { ok: false, message: "That picture is larger than 8 MB." };
  if (!detectImageMimeType(buffer)) return { ok: false, message: "Upload a JPEG, PNG or WebP picture." };
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_FIGURE_SIDE, height: MAX_FIGURE_SIDE, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { ok: true, png: data, widthPx: info.width, heightPx: info.height };
  } catch {
    return { ok: false, message: "That picture could not be read." };
  }
}
