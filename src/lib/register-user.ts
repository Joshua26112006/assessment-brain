import bcrypt from "bcryptjs";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export type RegisterUserInput = {
  name: unknown;
  email: unknown;
  password: unknown;
  role: unknown;
};

export type RegisterFieldErrors = Partial<
  Record<"name" | "email" | "password" | "role", string>
>;

export type RegisterUserResult =
  | {
      ok: true;
      user: { id: string; name: string; email: string; role: Role };
    }
  | { ok: false; status: 400; fieldErrors: RegisterFieldErrors }
  | { ok: false; status: 409; message: string };

/**
 * Validates and creates a new User. Every field is treated as untrusted
 * input (typed `unknown`) regardless of what the client claims to send —
 * in particular, `role` is only ever accepted if it exactly matches one of
 * the real Prisma `Role` enum values, never trusted as an arbitrary string.
 */
export async function registerUser(
  input: RegisterUserInput,
): Promise<RegisterUserResult> {
  const fieldErrors: RegisterFieldErrors = {};

  const rawName = input.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) {
    fieldErrors.name = "Name is required.";
  }

  const rawEmail = input.email;
  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email) {
    fieldErrors.email = "Email is required.";
  } else if (!EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  const password = typeof input.password === "string" ? input.password : "";
  if (!password) {
    fieldErrors.password = "Password is required.";
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    fieldErrors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  const rawRole = input.role;
  const role =
    typeof rawRole === "string" &&
    (Object.values(Role) as string[]).includes(rawRole)
      ? (rawRole as Role)
      : null;
  if (!role) {
    fieldErrors.role = "Select whether you are a Teacher or a Student.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, fieldErrors };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: role as Role },
      select: { id: true, name: true, email: true, role: true },
    });
    return { ok: true, user };
  } catch (error) {
    // P2002 = unique constraint violation (email already registered).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: false,
        status: 409,
        message: "An account with this email already exists.",
      };
    }
    throw error;
  }
}
