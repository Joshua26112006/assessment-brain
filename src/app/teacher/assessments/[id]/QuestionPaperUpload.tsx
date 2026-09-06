"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Page";
import { buttonClass } from "@/components/ui/styles";

const ACCEPT_ATTR = "application/pdf,image/jpeg,image/png,image/webp";
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

interface PendingFile {
  localId: string;
  file: File;
  previewUrl: string | null;
  error: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Unsupported file type. Only PDF, JPEG, PNG, and WEBP are allowed.";
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`;
  }
  return null;
}

/**
 * The teacher's entry point into the AI extraction workflow: upload a
 * single PDF, or one-to-many image pages (photographed/scanned), before any
 * questions exist for this assessment. Only rendered while there is no
 * current QuestionPaper draft and no real Questions yet — see
 * QuestionPaperSection.tsx.
 */
export default function QuestionPaperUpload({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<PendingFile[]>([]);

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);
  useEffect(() => {
    return () => {
      for (const pending of pendingFilesRef.current) {
        if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      }
    };
  }, []);

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);

    // A PDF represents the whole document on its own — mixing it with
    // separate image pages (or multiple PDFs) makes page order ambiguous.
    const hasPdf = incoming.some((f) => f.type === "application/pdf") ||
      pendingFiles.some((p) => p.file.type === "application/pdf");
    if (hasPdf && (incoming.length > 1 || pendingFiles.length > 0)) {
      setUploadError("Upload either a single PDF, or one-to-many image pages — not both.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const next: PendingFile[] = incoming.map((file) => {
      const error = validateFile(file);
      return {
        localId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: !error && file.type !== "application/pdf" ? URL.createObjectURL(file) : null,
        error,
      };
    });
    setPendingFiles((prev) => [...prev, ...next]);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(localId: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  function moveFile(localId: string, direction: "up" | "down") {
    setPendingFiles((prev) => {
      const index = prev.findIndex((p) => p.localId === localId);
      if (index === -1) return prev;
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  }

  const hasBlockingError = pendingFiles.some((p) => p.error);

  async function handleUpload() {
    if (pendingFiles.length === 0 || hasBlockingError || isUploading) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      for (const pending of pendingFiles) {
        formData.append("files", pending.file, pending.file.name);
      }
      const response = await fetch(`/api/teacher/assessments/${assessmentId}/question-paper`, {
        method: "POST",
        body: formData,
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setUploadError((body && typeof body.error === "string" && body.error) || "Upload failed. Please try again.");
        return;
      }

      const failures = Array.isArray(body?.results)
        ? body.results.filter((r: { ok: boolean }) => !r.ok)
        : [];
      if (failures.length > 0 && failures.length === body.results.length) {
        setUploadError("None of the selected pages could be uploaded. Please check the files and try again.");
        return;
      }

      for (const pending of pendingFiles) {
        if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      }
      setPendingFiles([]);
      router.refresh();
    } catch {
      setUploadError("Network error. Please check your connection and try again.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="text-sm font-semibold">Upload question paper</h2>
      <p className="mt-1 text-sm text-muted">
        Upload the question paper as a PDF, or as photos of each page, and AI will draft the
        questions for you to review and approve. You&apos;ll still be able to edit everything before
        it becomes part of the assessment.
      </p>

      {pendingFiles.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {pendingFiles.map((pending, index) => (
            <li
              key={pending.localId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
            >
              {pending.previewUrl ? (
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                  <img
                    src={pending.previewUrl}
                    alt={`Preview of page ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-surface-muted text-[11px] font-medium text-muted">
                  PDF
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={pending.file.name}>
                  {pending.file.name}
                </p>
                <p className="text-xs text-subtle">{formatFileSize(pending.file.size)}</p>
                {pending.error && (
                  <p className="text-xs font-medium text-danger">{pending.error}</p>
                )}
              </div>
              {pending.file.type !== "application/pdf" && pendingFiles.length > 1 && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={`Move page ${index + 1} up`}
                    onClick={() => moveFile(pending.localId, "up")}
                    disabled={index === 0}
                    className={buttonClass("secondary", "sm")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move page ${index + 1} down`}
                    onClick={() => moveFile(pending.localId, "down")}
                    disabled={index === pendingFiles.length - 1}
                    className={buttonClass("secondary", "sm")}
                  >
                    ↓
                  </button>
                </div>
              )}
              <button
                type="button"
                aria-label={`Remove ${pending.file.name}`}
                onClick={() => removeFile(pending.localId)}
                className={buttonClass("danger", "sm")}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          disabled={isUploading}
          onChange={(e) => handleFilesSelected(e.target.files)}
          className="sr-only"
          id="question-paper-file-input"
        />
        <label
          htmlFor="question-paper-file-input"
          className={`${buttonClass("secondary")} ${isUploading ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
        >
          {pendingFiles.length > 0 ? "Add more pages" : "Select file(s)"}
        </label>

        {pendingFiles.length > 0 && (
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || hasBlockingError}
            className={buttonClass("primary")}
          >
            {isUploading ? "Uploading…" : `Upload ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      {uploadError && (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {uploadError}
        </p>
      )}
    </Card>
  );
}
