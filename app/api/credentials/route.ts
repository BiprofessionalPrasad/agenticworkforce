import type { NextRequest } from "next/server";
import { getAllCredentials, saveCredential, deleteCredential } from "../../../lib/storage";
import { getCurrentUser } from "../../../lib/session";
import type { Credential } from "../../../lib/types";

// GET /api/credentials - list current user's
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const credentials = await getAllCredentials(user.id);
    return Response.json({ success: true, data: { credentials } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to load credentials" }, { status: 500 });
  }
}

// POST /api/credentials - create or update (if id provided) user scoped
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const name = body.name || "Untitled Credential";
    const type = body.type || "generic";
    // Accept either raw data (will be encrypted server-side) or pre-encrypted
    const data = body.data || undefined;
    const encryptedData = body.encryptedData;
    const forNodeTypes = Array.isArray(body.forNodeTypes) ? body.forNodeTypes : undefined;

    const saved = await saveCredential({
      id: body.id,
      name,
      type,
      data,
      encryptedData,
      forNodeTypes,
      userId: user.id,
    } as any, user.id);
    return Response.json({ success: true, data: { credential: saved } }, { status: 201 });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to save credential" }, { status: 500 });
  }
}

// DELETE support for completeness
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ success: false, error: "id required" }, { status: 400 });
    const ok = await deleteCredential(id, user.id);
    if (!ok) return Response.json({ success: false, error: "Not found or not owned" }, { status: 404 });
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to delete credential" }, { status: 500 });
  }
}
