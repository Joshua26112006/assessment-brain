"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, getSession } from "next-auth/react";
import { dashboardPathForRole } from "@/lib/dashboard-path";
import type { Role } from "@prisma/client";

type FieldErrors = Partial<
  Record<"name" | "email" | "password" | "role", string>
>;

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 400 && data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
        } else {
          setFormError(data?.error ?? "Registration failed. Please try again.");
        }
        return;
      }

      // Automatically sign the new user in — don't ask them to log in again.
      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!signInResult || signInResult.error) {
        // Account was created but auto sign-in failed for some reason;
        // send them to sign in manually rather than leaving them stuck.
        router.push("/login");
        return;
      }

      // Redirect based on the authenticated, database-derived role — never
      // the role the user happened to select in this form.
      const session = await getSession();
      const authenticatedRole = session?.user.role;
      router.push(
        authenticatedRole ? dashboardPathForRole(authenticatedRole) : "/login",
      );
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
        .
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Full Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
          {fieldErrors.name && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.name}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email Address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
          {fieldErrors.email && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.email}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
          {fieldErrors.password && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p>
          )}
        </div>

        <fieldset>
          <legend className="block text-sm font-medium">I am a...</legend>
          <div className="mt-1 flex gap-3">
            <label className="flex flex-1 items-center justify-center gap-2 rounded-md border border-black/15 px-3 py-2 text-sm has-checked:border-black has-checked:bg-black/5 dark:border-white/20 dark:has-checked:border-white dark:has-checked:bg-white/10">
              <input
                type="radio"
                name="role"
                value="TEACHER"
                checked={role === "TEACHER"}
                onChange={() => setRole("TEACHER")}
              />
              Teacher
            </label>
            <label className="flex flex-1 items-center justify-center gap-2 rounded-md border border-black/15 px-3 py-2 text-sm has-checked:border-black has-checked:bg-black/5 dark:border-white/20 dark:has-checked:border-white dark:has-checked:bg-white/10">
              <input
                type="radio"
                name="role"
                value="STUDENT"
                checked={role === "STUDENT"}
                onChange={() => setRole("STUDENT")}
              />
              Student
            </label>
          </div>
          {fieldErrors.role && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.role}</p>
          )}
        </fieldset>

        {formError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {isSubmitting ? "Creating account..." : "Create account"}
        </button>
      </form>
    </div>
  );
}
