import { Card } from "@/components/ui/Page";

export interface QuestionPaperQuestion {
  id: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
}

/**
 * A read-only digital question paper — no answer inputs. The handwritten
 * workflow expects the student to write on physical paper, so this
 * deliberately never renders a textarea under a question (see the Phase 3.2
 * report for the full reasoning).
 */
export default function QuestionPaper({
  questions,
  totalMarks,
  instructions,
}: {
  questions: QuestionPaperQuestion[];
  totalMarks: number;
  /** The assessment's own instructions text, if the teacher provided one — never invented. */
  instructions?: string | null;
}) {
  return (
    <Card className="mb-6" padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Question paper</h2>
        <dl className="flex gap-5 text-sm">
          <div className="text-right">
            <dt className="text-xs text-subtle">Questions</dt>
            <dd className="font-semibold tabular-nums">{questions.length}</dd>
          </div>
          <div className="text-right">
            <dt className="text-xs text-subtle">Total marks</dt>
            <dd className="font-semibold tabular-nums">{totalMarks}</dd>
          </div>
        </dl>
      </div>

      {instructions && (
        <div className="border-b border-line bg-surface-muted p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Instructions</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{instructions}</p>
        </div>
      )}

      <ol className="divide-y divide-line">
        {questions.map((question) => (
          <li key={question.id} className="p-5">
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface-muted text-xs font-semibold text-muted"
              >
                {question.questionNumber}
              </span>
              <span className="text-xs font-medium text-subtle">
                Question {question.questionNumber} · {question.maximumMarks} marks
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap pl-8 text-sm leading-relaxed">
              {question.questionText}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
