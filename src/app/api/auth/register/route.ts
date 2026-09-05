import { NextResponse } from "next/server";
import { registerUser, type RegisterUserInput } from "@/lib/register-user";

export async function POST(request: Request) {
  let body: Partial<RegisterUserInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const result = await registerUser({
    name: body?.name,
    email: body?.email,
    password: body?.password,
    role: body?.role,
  });

  if (!result.ok) {
    if (result.status === 400) {
      return NextResponse.json(
        { error: "Please fix the highlighted fields.", fieldErrors: result.fieldErrors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: result.message }, { status: 409 });
  }

  return NextResponse.json({ user: result.user }, { status: 201 });
}
