"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, getSession } from "next-auth/react";
import { dashboardPathForRole } from "@/lib/dashboard-path";
import type { Role } from "@prisma/client";
import { buttonClass, fieldErrorClass, inputClass, labelClass } from "@/components/ui/styles";

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
    <div className="mx-auto max-w-sm py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent-text hover:underline">
          Sign in
        </Link>
        .
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-6 flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
      >
        <div>
          <label htmlFor="name" className={labelClass}>
            Full Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          {fieldErrors.name && (
            <p className={fieldErrorClass}>{fieldErrors.name}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email Address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          {fieldErrors.email && (
            <p className={fieldErrorClass}>{fieldErrors.email}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          {fieldErrors.password && (
            <p className={fieldErrorClass}>{fieldErrors.password}</p>
          )}
        </div>

        <fieldset>
          <legend className={labelClass}>I am a...</legend>
          <div className="mt-1 flex gap-3">
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm transition-colors has-checked:border-accent has-checked:bg-accent-soft has-checked:font-medium has-checked:text-accent-text">
              <input
                type="radio"
                name="role"
                value="TEACHER"
                checked={role === "TEACHER"}
                onChange={() => setRole("TEACHER")}
              />
              Teacher
            </label>
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm transition-colors has-checked:border-accent has-checked:bg-accent-soft has-checked:font-medium has-checked:text-accent-text">
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
            <p className={fieldErrorClass}>{fieldErrors.role}</p>
          )}
        </fieldset>

        {formError && (
          <p className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={buttonClass("primary", "md", "mt-2 w-full")}
        >
          {isSubmitting ? "Creating account..." : "Create account"}
        </button>
      </form>
    </div>
  );
}
