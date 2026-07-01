import { getCurrentUser } from "../../../../lib/session";
import { ensureScheduler } from "../../../../lib/scheduler";

export async function GET() {
  try {
    await ensureScheduler();
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "No session" }, { status: 401 });
    }
    return Response.json({ success: true, data: { user } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Session error" }, { status: 500 });
  }
}
