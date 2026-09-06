/**
 * Dependency-free file-signature (magic-byte) sniffing shared by every
 * domain that validates uploaded file content against its actual bytes
 * rather than a client-supplied MIME type — see
 * src/lib/storage/answerSheets.ts and src/lib/storage/questionPapers.ts,
 * the two current callers. Kept in one place so "what counts as a real
 * JPEG/PNG/WEBP" can never quietly drift between them.
 */

export type DetectedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export function detectImageMimeType(buffer: Buffer): DetectedImageMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** PDF files begin with the literal bytes "%PDF-" (e.g. "%PDF-1.7"). */
export function isPdfSignature(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}
