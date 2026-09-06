"use client";

import { useActionState, useEffect, useRef, useState, type RefObject } from "react";
import { Card } from "@/components/ui/Page";
import { buttonClass } from "@/components/ui/styles";
import type { AnswerSheetPageSummary } from "@/lib/storage/answerSheets";
import { submitAnswerSheetsForEvaluation, type AnswerSheetSubmitState } from "./answerSheetActions";

const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_ACCEPT_ATTR = "image/jpeg,image/png,image/webp";
// UX-only mirror of MAX_ANSWER_SHEET_FILE_SIZE_BYTES (src/lib/storage/answerSheets.ts) —
// catches an obviously oversized file before spending a round trip on it.
// The server's own check is the real security boundary, not this one.
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface PendingFile {
  localId: string;
  file: File;
  previewUrl: string;
  status: "idle" | "uploading" | "error";
  error?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return "Unsupported file type. Only JPEG, PNG, and WEBP images are allowed.";
  }
  if (file.size === 0) {
    return "This file is empty.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`;
  }
  return null;
}

export default function AnswerSheetWorkflow({
  submissionId,
  initialPages,
}: {
  submissionId: string;
  initialPages: AnswerSheetPageSummary[];
}) {
  const [uploadedPages, setUploadedPages] = useState<AnswerSheetPageSummary[]>(initialPages);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [uploadSummary, setUploadSummary] = useState<{
    tone: "success" | "warning" | "danger";
    message: string;
  } | null>(null);
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Always holds the latest pendingFiles so the unmount-only cleanup effect
  // below can revoke every outstanding object URL without needing
  // pendingFiles itself in its dependency array (which would re-run the
  // cleanup — and revoke live preview URLs — on every state update).
  const pendingFilesRef = useRef<PendingFile[]>([]);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);
  useEffect(() => {
    return () => {
      for (const pending of pendingFilesRef.current) {
        URL.revokeObjectURL(pending.previewUrl);
      }
    };
  }, []);

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const next: PendingFile[] = Array.from(fileList).map((file) => {
      const error = validateFile(file);
      return {
        localId:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: error ? "error" : "idle",
        error: error ?? undefined,
      };
    });
    setPendingFiles((prev) => [...prev, ...next]);
    setUploadSummary(null);
    // Reset so selecting the exact same file again later still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePendingFile(localId: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  function movePendingFile(localId: string, direction: "up" | "down") {
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

  async function handleUpload() {
    const toUpload = pendingFiles.filter((p) => p.status !== "uploading");
    if (toUpload.length === 0 || isUploading) return;

    setIsUploading(true);
    setUploadSummary(null);
    setDeleteError(null);

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < toUpload.length; i++) {
      const pending = toUpload[i];
      setUploadProgress({ current: i + 1, total: toUpload.length });
      setPendingFiles((prev) =>
        prev.map((p) => (p.localId === pending.localId ? { ...p, status: "uploading", error: undefined } : p)),
      );

      try {
        const formData = new FormData();
        formData.append("files", pending.file, pending.file.name);
        const response = await fetch(
          `/api/student/submissions/${submissionId}/answer-sheets`,
          { method: "POST", body: formData },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message =
            (body && typeof body.error === "string" && body.error) ||
            "Upload failed. Please try again.";
          setPendingFiles((prev) =>
            prev.map((p) =>
              p.localId === pending.localId ? { ...p, status: "error", error: message } : p,
            ),
          );
          failureCount += 1;
          continue;
        }

        const body = (await response.json()) as {
          results: Array<{ ok: true; page: AnswerSheetPageSummary } | { ok: false; error: string }>;
        };
        const result = body.results[0];

        if (result && result.ok) {
          setUploadedPages((prev) =>
            [...prev, result.page].sort((a, b) => a.pageNumber - b.pageNumber),
          );
          URL.revokeObjectURL(pending.previewUrl);
          setPendingFiles((prev) => prev.filter((p) => p.localId !== pending.localId));
          successCount += 1;
        } else {
          const message = result && !result.ok ? result.error : "Upload failed. Please try again.";
          setPendingFiles((prev) =>
            prev.map((p) =>
              p.localId === pending.localId ? { ...p, status: "error", error: message } : p,
            ),
          );
          failureCount += 1;
        }
      } catch {
        setPendingFiles((prev) =>
          prev.map((p) =>
            p.localId === pending.localId
              ? { ...p, status: "error", error: "Network error. Please check your connection and try again." }
              : p,
          ),
        );
        failureCount += 1;
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    if (failureCount === 0) {
      setUploadSummary({
        tone: "success",
        message: `${successCount} page${successCount === 1 ? "" : "s"} uploaded successfully.`,
      });
    } else if (successCount === 0) {
      setUploadSummary({
        tone: "danger",
        message: `${failureCount} page${failureCount === 1 ? "" : "s"} failed to upload. Review the errors below and try again.`,
      });
    } else {
      setUploadSummary({
        tone: "warning",
        message: `${successCount} page${successCount === 1 ? "" : "s"} uploaded, ${failureCount} failed. Review the errors below — fixing and re-uploading won't duplicate the pages that already succeeded.`,
      });
    }
  }

  async function handleDeleteUploadedPage(pageId: string) {
    setDeletingPageId(pageId);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/student/submissions/${submissionId}/answer-sheets/${pageId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setDeleteError(
          (body && typeof body.error === "string" && body.error) ||
            "Couldn't remove this page. Please try again.",
        );
        return;
      }
      setUploadedPages((prev) => prev.filter((p) => p.id !== pageId));
    } catch {
      setDeleteError("Network error. Please check your connection and try again.");
    } finally {
      setDeletingPageId(null);
    }
  }

  const pendingErrorCount = pendingFiles.filter((p) => p.status === "error").length;
  const hasAnyPages = uploadedPages.length > 0;
  const disableWorkflowControls = isUploading;

  return (
    <div className="flex flex-col gap-6">
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Answer sheets</h2>
          <span className="text-xs text-subtle">
            {uploadedPages.length} page{uploadedPages.length === 1 ? "" : "s"} uploaded
          </span>
        </div>

        <div className="p-5">
          {!hasAnyPages && pendingFiles.length === 0 && (
            <div className="rounded-xl border border-dashed border-line-strong bg-surface-muted px-6 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No answer sheet pages yet</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
                Photograph or scan each page of your handwritten answers, then select them below.
              </p>
              <div className="mt-5 flex justify-center">
                <SelectPagesButton
                  fileInputRef={fileInputRef}
                  onFilesSelected={handleFilesSelected}
                  disabled={disableWorkflowControls}
                  label="Select pages to upload"
                />
              </div>
            </div>
          )}

          {hasAnyPages && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {uploadedPages.map((page) => (
                <li key={page.id} className="rounded-lg border border-line bg-surface p-3">
                  <div className="aspect-[4/3] overflow-hidden rounded-md bg-surface-muted">
                    {/* Same-origin request: the browser automatically sends the
                        session cookie, so this authorized endpoint renders
                        directly as an <img> without any public URL. */}
                    <img
                      src={`/api/student/submissions/${submissionId}/answer-sheets/${page.id}`}
                      alt={`Page ${page.pageNumber} of your answer sheet`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">Page {page.pageNumber}</span>
                    <span className="text-[11px] text-subtle">{formatFileSize(page.fileSizeBytes)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-subtle" title={page.originalFilename}>
                    {page.originalFilename}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={`/api/student/submissions/${submissionId}/answer-sheets/${page.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass("secondary", "sm")}
                    >
                      View
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDeleteUploadedPage(page.id)}
                      disabled={deletingPageId === page.id || disableWorkflowControls}
                      className={buttonClass("danger", "sm")}
                    >
                      {deletingPageId === page.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {deleteError && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger">
              {deleteError}
            </p>
          )}

          {pendingFiles.length > 0 && (
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                New pages — not uploaded yet
              </h3>
              <ul className="mt-3 flex flex-col gap-2">
                {pendingFiles.map((pending, index) => (
                  <li
                    key={pending.localId}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
                  >
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                      <img
                        src={pending.previewUrl}
                        alt={`Preview of page ${uploadedPages.length + index + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        Page {uploadedPages.length + index + 1}
                      </p>
                      <p className="truncate text-xs text-subtle" title={pending.file.name}>
                        {pending.file.name} · {formatFileSize(pending.file.size)}
                      </p>
                      <p className="text-xs font-medium" aria-live="polite">
                        {pending.status === "uploading" && (
                          <span className="text-muted">Uploading…</span>
                        )}
                        {pending.status === "error" && (
                          <span className="text-danger">{pending.error}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Move page ${index + 1} up`}
                        onClick={() => movePendingFile(pending.localId, "up")}
                        disabled={index === 0 || disableWorkflowControls}
                        className={buttonClass("secondary", "sm")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move page ${index + 1} down`}
                        onClick={() => movePendingFile(pending.localId, "down")}
                        disabled={index === pendingFiles.length - 1 || disableWorkflowControls}
                        className={buttonClass("secondary", "sm")}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove page ${index + 1}`}
                        onClick={() => removePendingFile(pending.localId)}
                        disabled={disableWorkflowControls}
                        className={buttonClass("danger", "sm")}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(hasAnyPages || pendingFiles.length > 0) && (
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <SelectPagesButton
                fileInputRef={fileInputRef}
                onFilesSelected={handleFilesSelected}
                disabled={disableWorkflowControls}
                label="Add more pages"
                variant="secondary"
              />
              {pendingFiles.length > 0 && (
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={disableWorkflowControls}
                  className={buttonClass("primary")}
                >
                  {isUploading
                    ? uploadProgress
                      ? `Uploading page ${uploadProgress.current} of ${uploadProgress.total}…`
                      : "Uploading…"
                    : `Upload ${pendingFiles.length} page${pendingFiles.length === 1 ? "" : "s"}`}
                </button>
              )}
              {pendingErrorCount > 0 && !isUploading && (
                <span className="text-xs font-medium text-danger">
                  {pendingErrorCount} page{pendingErrorCount === 1 ? "" : "s"} need attention before
                  uploading again.
                </span>
              )}
            </div>
          )}

          {uploadSummary && (
            <p
              role="status"
              aria-live="polite"
              className={`mt-4 rounded-lg border p-3 text-sm font-medium ${
                uploadSummary.tone === "success"
                  ? "border-success-line bg-success-soft text-success"
                  : uploadSummary.tone === "warning"
                    ? "border-warning-line bg-warning-soft text-warning"
                    : "border-danger-line bg-danger-soft text-danger"
              }`}
            >
              {uploadSummary.message}
            </p>
          )}
        </div>
      </Card>

      <SubmitAnswerSheetsPanel
        submissionId={submissionId}
        hasPages={hasAnyPages}
        isUploading={isUploading}
      />
    </div>
  );
}

function SelectPagesButton({
  fileInputRef,
  onFilesSelected,
  disabled,
  label,
  variant = "primary",
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: FileList | null) => void;
  disabled: boolean;
  label: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_ACCEPT_ATTR}
        multiple
        disabled={disabled}
        onChange={(e) => onFilesSelected(e.target.files)}
        className="sr-only"
        id="answer-sheet-file-input"
      />
      <label
        htmlFor="answer-sheet-file-input"
        className={`${buttonClass(variant)} ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
      >
        {label}
      </label>
    </>
  );
}

const initialSubmitState: AnswerSheetSubmitState = {};

function SubmitAnswerSheetsPanel({
  submissionId,
  hasPages,
  isUploading,
}: {
  submissionId: string;
  hasPages: boolean;
  isUploading: boolean;
}) {
  const action = submitAnswerSheetsForEvaluation.bind(null, submissionId);
  const [state, formAction, isPending] = useActionState(action, initialSubmitState);
  const [isConfirming, setIsConfirming] = useState(false);

  const canSubmit = hasPages && !isUploading;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Ready to submit?</p>
          <p className="mt-1 text-sm text-muted">
            {!hasPages
              ? "Upload at least one answer-sheet page before you can submit."
              : isUploading
                ? "Wait for the current upload to finish before submitting."
                : "Submitting locks your answer sheets and sends them for evaluation."}
          </p>
        </div>

        {!isConfirming ? (
          <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
            <button
              type="button"
              onClick={() => setIsConfirming(true)}
              disabled={!canSubmit}
              className={buttonClass("primary")}
            >
              Submit for evaluation
            </button>
            {state.error && (
              <p role="alert" className="text-right text-xs font-medium text-danger">
                {state.error}
              </p>
            )}
          </div>
        ) : (
          <div className="w-full rounded-lg border border-warning-line bg-warning-soft p-4 sm:w-96">
            <p className="text-sm font-medium text-warning">Submit for evaluation?</p>
            <p className="mt-1 text-xs text-warning">
              Are you sure you want to submit your answer sheets for evaluation? You may not be able
              to modify them afterward.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={formAction}>
                <button type="submit" disabled={isPending} className={buttonClass("primary", "sm")}>
                  {isPending ? "Submitting…" : "Yes, submit"}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setIsConfirming(false)}
                disabled={isPending}
                className={buttonClass("secondary", "sm")}
              >
                Keep working
              </button>
            </div>
            {state.error && (
              <p role="alert" className="mt-2 text-xs font-medium text-danger">
                {state.error}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
