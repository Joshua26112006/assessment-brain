import { NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTeacherApiSession } from "@/lib/api-session";
import {
  findCurrentQuestionPaperForTeacher,
  findOwnedAssessmentForTeacher,
  isDraftExtractionStatus,
} from "@/lib/questionPaperAccess";
import {
  MAX_QUESTION_PAPER_PAGES,
  MAX_QUESTION_PAPER_TOTAL_BYTES,
  nextAvailableQuestionPaperPageNumber,
  removeQuestionPaperPageFile,
  uploadQuestionPaperPage,
  type QuestionPaperPageSummary,
} from "@/lib/storage/questionPapers";
import { runQuestionPaperExtraction } from "@/lib/questionPaperExtraction";

/**
 * Upload / remove the question paper for one of the authenticated teacher's
 * own Assessments.
 *
 * Route handler, not a Server Action: this accepts multipart/form-data file
 * uploads (a scanned PDF or several phone photos can exceed a few hundred
 * KB, past Next.js's 1MB default Server Action body limit) — the same
 * reasoning as the Phase 3.1 answer-sheet upload endpoint, which this
 * mirrors closely.
 *
 * This endpoint never creates real Assessment Questions itself — it only
 * stores the uploaded document and (in the background, via after()) runs AI
 * extraction into a QuestionPaper draft. Only the explicit approval action
 * (questionPaperActions.ts) creates Questions.
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTeacherApiSession();
  if (!session.ok) return session.response;
  const { id: assessmentId } = await params;
  const teacherId = session.session.user.id;

  const assessment = await findOwnedAssessmentForTeacher(assessmentId, teacherId);
  if (!assessment) {
    return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  }

  // Duplicate-upload protection (Step 15): only one non-terminal draft may
  // exist per assessment at a time. A teacher who wants to upload a
  // different file must explicitly remove the current draft first (DELETE
  // below) rather than silently accumulating parallel QuestionPaper rows.
  const existing = await findCurrentQuestionPaperForTeacher(assessmentId, teacherId);
  if (existing && isDraftExtractionStatus(existing.extractionStatus)) {
    return NextResponse.json(
      {
        error:
          "A question paper is already uploaded for this assessment. Remove it before uploading a different one.",
      },
      { status: 409 },
    );
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
  if (files.length > MAX_QUESTION_PAPER_PAGES) {
    return NextResponse.json(
      { error: `A question paper can have at most ${MAX_QUESTION_PAPER_PAGES} pages.` },
      { status: 400 },
    );
  }

  // Bounds worst-case memory usage and the eventual AI request payload size
  // — MAX_QUESTION_PAPER_PAGES x MAX_QUESTION_PAPER_FILE_SIZE_BYTES alone
  // would allow a single batch up to ~400MB. Checked from the browser-
  // reported File.size (cheap, no bytes read yet); the per-file magic-byte
  // check below still independently validates actual content.
  const totalDeclaredSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalDeclaredSize > MAX_QUESTION_PAPER_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `The combined size of all pages exceeds the ${MAX_QUESTION_PAPER_TOTAL_BYTES / (1024 * 1024)}MB limit for one upload.`,
      },
      { status: 400 },
    );
  }

  // A PDF already carries every page internally, so it must be the only
  // file in the upload — mixing it with separate image pages would leave
  // page ordering ambiguous between the two representations.
  if (files.length > 1) {
    const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
    const anyPdf = buffers.some(
      (buf) => Buffer.from(buf).subarray(0, 5).toString("ascii") === "%PDF-",
    );
    if (anyPdf) {
      return NextResponse.json(
        {
          error:
            "Upload either a single PDF or one-to-many image pages, not a mix of both in one request.",
        },
        { status: 400 },
      );
    }
  }

  const questionPaper = await prisma.questionPaper.create({
    data: { assessmentId, extractionStatus: "PENDING" },
  });

  type UploadResultEntry =
    | { originalFilename: string; ok: true; page: QuestionPaperPageSummary }
    | { originalFilename: string; ok: false; error: string };

  const results: UploadResultEntry[] = [];
  let pageNumber = await nextAvailableQuestionPaperPageNumber(questionPaper.id);

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadQuestionPaperPage({
      questionPaperId: questionPaper.id,
      pageNumber,
      buffer,
      originalFilename: file.name || "question-paper",
    });

    if (result.ok) {
      results.push({ originalFilename: file.name, ok: true, page: result.page });
      pageNumber += 1;
    } else {
      results.push({ originalFilename: file.name, ok: false, error: result.error });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  if (successCount === 0) {
    // Nothing usable was uploaded — remove the now-empty QuestionPaper
    // record rather than leaving a permanent PENDING row with zero pages.
    await prisma.questionPaper.delete({ where: { id: questionPaper.id } }).catch(() => {});
    return NextResponse.json({ results }, { status: 400 });
  }

  // Extraction runs after the response is sent, mirroring the existing
  // background-pipeline pattern in the student submit action — the teacher
  // isn't made to wait for the AI call before their upload is acknowledged.
  after(async () => {
    await runQuestionPaperExtraction(questionPaper.id);
  });

  return NextResponse.json({ questionPaperId: questionPaper.id, results });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTeacherApiSession();
  if (!session.ok) return session.response;
  const { id: assessmentId } = await params;
  const teacherId = session.session.user.id;

  const current = await findCurrentQuestionPaperForTeacher(assessmentId, teacherId);
  if (!current) {
    return NextResponse.json({ error: "No question paper found for this assessment." }, { status: 404 });
  }
  if (current.extractionStatus === "APPROVED") {
    return NextResponse.json(
      { error: "This question paper has already been approved and can no longer be removed." },
      { status: 409 },
    );
  }

  // Database row + pages deleted first (cascade), then best-effort storage
  // cleanup for each page's file — same ordering discipline as
  // deleteAnswerSheetPage in Phase 3.1.
  const pages = current.pages;
  await prisma.questionPaper.delete({ where: { id: current.id } });
  await Promise.all(pages.map((page) => removeQuestionPaperPageFile(page.storageKey)));

  return NextResponse.json({ success: true });
}
