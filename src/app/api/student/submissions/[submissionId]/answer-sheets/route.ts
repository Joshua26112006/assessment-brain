import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentApiSession } from "@/lib/api-session";
import { findOwnedSubmissionForStudent, isAnswerSheetEditableStatus } from "@/lib/answerSheetAccess";
import {
  nextAvailablePageNumber,
  uploadAnswerSheetPage,
  type AnswerSheetPageSummary,
} from "@/lib/storage/answerSheets";

/**
 * List / upload answer-sheet pages for one of the authenticated student's
 * own Submissions.
 *
 * Route handler, not a Server Action: this accepts multipart/form-data
 * image uploads (phone photos routinely exceed a few hundred KB, well past
 * Next.js's 1MB default Server Action body limit), and route handlers have
 * no such limit — see the Phase 3 architecture audit for the full reasoning.
 *
 * This endpoint is additive: it has no effect on QuestionResponse, the
 * evaluation pipeline, or the existing typed-answer flow. Nothing here is
 * wired into the AI pipeline yet.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireStudentApiSession();
  if (!session.ok) return session.response;
  const { submissionId } = await params;

  const submission = await findOwnedSubmissionForStudent(submissionId, session.session.user.id);
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const pages = await prisma.answerSheetPage.findMany({
    where: { submissionId },
    orderBy: { pageNumber: "asc" },
    select: {
      id: true,
      pageNumber: true,
      originalFilename: true,
      mimeType: true,
      fileSizeBytes: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ pages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireStudentApiSession();
  if (!session.ok) return session.response;
  const { submissionId } = await params;
  const studentId = session.session.user.id;

  // Ownership and state are re-verified here independently of whatever
  // page linked to this endpoint — the submissionId in the URL is never
  // trusted on its own, mirroring getEditableOwnedSubmission in
  // take/actions.ts.
  const submission = await findOwnedSubmissionForStudent(submissionId, studentId);
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }
  if (!isAnswerSheetEditableStatus(submission.status)) {
    return NextResponse.json(
      { error: "Answer sheets can only be uploaded while the submission is still in progress." },
      { status: 409 },
    );
  }
  // Defense-in-depth, matching submitAssessment's own re-check: a teacher
  // could withdraw the assessment between the student opening it and
  // uploading pages.
  if (submission.assessment.status !== "PUBLISHED") {
    return NextResponse.json({ error: "This assessment is no longer available." }, { status: 409 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were provided." }, { status: 400 });
  }

  // Assigned sequentially and in-memory across this one request — files
  // within a single upload session are processed one at a time (not
  // Promise.all) specifically so page numbers are assigned in the order
  // the pages were provided, never racing each other. A genuinely
  // concurrent second request is still safely rejected per-file by the
  // submissionId+pageNumber uniqueness constraint (see the "already
  // exists" branch below), not silently double-assigned.
  let pageNumber = await nextAvailablePageNumber(submissionId);

  type UploadResultEntry =
    | { originalFilename: string; ok: true; page: AnswerSheetPageSummary }
    | { originalFilename: string; ok: false; error: string };

  const results: UploadResultEntry[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadAnswerSheetPage({
      submissionId,
      pageNumber,
      buffer,
      originalFilename: file.name || "page",
    });

    if (result.ok) {
      results.push({ originalFilename: file.name, ok: true, page: result.page });
      pageNumber += 1;
    } else {
      results.push({ originalFilename: file.name, ok: false, error: result.error });
    }
  }

  return NextResponse.json({ results });
}
