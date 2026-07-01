import type { NextRequest } from "next/server";
import { getCredential, saveCredential, deleteCredential } from "../../../../lib/storage";
import { getCurrentUser } from "../../../../lib/session";
import type { Credential } from "../../../../lib/types";

// GET /api/credentials/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const cred = await getCredential(id, user.id);
    if (!cred) {
      return Response.json({ success: false, error: "Credential not found" }, { status: 404 });
    }
    return Response.json({ success: true, data: { credential: cred } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to load credential" }, { status: 500 });
  }
}

// PUT /api/credentials/[id] - update
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();
    const existing = await getCredential(id, user.id);
    if (!existing) {
      return Response.json({ success: false, error: "Credential not found" }, { status: 404 });
    }

    const updated = await saveCredential({
      id,
      name: body.name || existing.name,
      type: body.type || existing.type,
      data: body.data,
      encryptedData: body.encryptedData,
      userId: user.id,
    } as any, user.id);
    return Response.json({ success: true, data: { credential: updated } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to update credential" }, { status: 500 });
  }
}

// DELETE /api/credentials/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const ok = await deleteCredential(id, user.id);
    if (!ok) {
      return Response.json({ success: false, error: "Credential not found or not owned" }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to delete credential" }, { status: 500 });
  }
}
