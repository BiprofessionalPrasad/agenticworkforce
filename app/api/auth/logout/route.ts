import { deleteSession } from "../../../../lib/session";

export async function POST() {
  try {
    await deleteSession();
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Logout failed" }, { status: 500 });
  }
}
