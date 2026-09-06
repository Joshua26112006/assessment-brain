import Link from "next/link";
import { auth } from "@/lib/auth";
import { dashboardPathForRole } from "@/lib/dashboard-path";
import { buttonClass } from "@/components/ui/styles";

const PIPELINE_STEPS = [
  {
    title: "Teachers set the standard",
    body: "Create questions and rubrics with accepted solution approaches and marking checkpoints. Rubrics are versioned, and every evaluation is pinned to the exact version it used.",
  },
  {
    title: "Answers are evaluated against evidence",
    body: "Each response is matched against the rubric checkpoint by checkpoint, independently re-evaluated, and the two results are compared. Disagreements go to verification rather than being averaged away.",
  },
  {
    title: "Teachers stay the authority",
    body: "Anything uncertain is flagged for review with its full evidence. A teacher confirms or overrides the mark, and the student's result updates.",
  },
];

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex flex-col gap-14">
      <section className="max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent-text">
          AI Decoder Academy
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">
          Assessment Brain
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          An assessment platform that marks student answers against a teacher&apos;s own rubric,
          shows its evidence for every mark, and asks a teacher whenever it isn&apos;t sure.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          {session ? (
            <Link href={dashboardPathForRole(session.user.role)} className={buttonClass("primary")}>
              Go to your dashboard
            </Link>
          ) : (
            <>
              <Link href="/register" className={buttonClass("primary")}>
                Create an account
              </Link>
              <Link href="/login" className={buttonClass("secondary")}>
                Sign in
              </Link>
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold">How a mark is produced</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {PIPELINE_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-xl border border-line bg-surface p-5"
            >
              <span
                aria-hidden="true"
                className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text"
              >
                {index + 1}
              </span>
              <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-line bg-surface-muted p-6">
        <h2 className="text-base font-semibold">Built to be checked, not trusted blindly</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          A mark is never a bare number. Every result carries the checkpoints it matched, the
          evidence found in the answer, whether the independent evaluation agreed, and whether a
          teacher confirmed it. Questions still being evaluated or awaiting review are reported as
          such — never counted as zero.
        </p>
      </section>
    </div>
  );
}
