import Link from "next/link";
import { auth } from "@/lib/auth";
import { dashboardPathForRole } from "@/lib/dashboard-path";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Assessment Brain
        </h1>
        <p className="mt-2 max-w-xl text-black/60 dark:text-white/60">
          A school assessment platform where teachers upload question
          papers, generate AI-assisted rubrics, and evaluate student answer
          sheets — while students submit their work and receive results.
        </p>
      </div>

      {session ? (
        <Link
          href={dashboardPathForRole(session.user.role)}
          className="w-fit rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Go to your dashboard
        </Link>
      ) : (
        <div className="flex gap-3">
          <Link
            href="/login"
            className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Login
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Register
          </Link>
        </div>
      )}
    </div>
  );
}
