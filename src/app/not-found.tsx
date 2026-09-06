import Link from "next/link";
import { buttonClass } from "@/components/ui/styles";

/**
 * Shown for unknown URLs and — deliberately — for any record a signed-in user
 * isn't allowed to reach. Several loaders call notFound() rather than a
 * "forbidden" page precisely so that another teacher's review item or another
 * student's submission is indistinguishable from one that never existed, and
 * this page must not undermine that by hinting the resource exists.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <p aria-hidden="true" className="text-4xl font-semibold tracking-tight text-subtle">
        404
      </p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        This page doesn&apos;t exist, or it isn&apos;t available to your account.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href="/" className={buttonClass("primary")}>
          Go home
        </Link>
      </div>
    </div>
  );
}
