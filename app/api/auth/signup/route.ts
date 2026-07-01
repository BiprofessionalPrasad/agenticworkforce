import type { NextRequest } from "next/server";
import { createUser } from "../../../../lib/storage";
import { createSession } from "../../../../lib/session";

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json().catch(() => ({}));
    if (!email || !password) {
      return Response.json({ success: false, error: "Email and password required" }, { status: 400 });
    }
    if (password.length < 4) {
      return Response.json({ success: false, error: "Password too short (demo: min 4)" }, { status: 400 });
    }
    const user = await createUser(email, password, name);
    await createSession(user);
    return Response.json({ success: true, data: { user: { id: user.id, email: user.email, name: user.name } } }, { status: 201 });
  } catch (err: any) {
    if (String(err.message).includes("already exists")) {
      return Response.json({ success: false, error: "User already exists" }, { status: 409 });
    }
    return Response.json({ success: false, error: err.message || "Signup failed" }, { status: 500 });
  }
}
