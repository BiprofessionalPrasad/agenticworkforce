import type { NextRequest } from "next/server";
import { validateUser, ensureDemoUser } from "../../../../lib/storage";
import { createSession } from "../../../../lib/session";

export async function POST(request: NextRequest) {
  try {
    await ensureDemoUser(); // ensure demo exists
    const { email, password } = await request.json().catch(() => ({}));
    if (!email || !password) {
      return Response.json({ success: false, error: "Email and password required" }, { status: 400 });
    }
    const user = await validateUser(email, password);
    if (!user) {
      return Response.json({ success: false, error: "Invalid credentials" }, { status: 401 });
    }
    await createSession(user);
    return Response.json({ success: true, data: { user: { id: user.id, email: user.email, name: user.name } } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Login failed" }, { status: 500 });
  }
}
