/**
 * Session / Auth utilities for n8nlike (MVP)
 * Implements JWT + httpOnly cookie sessions per Next.js 16 app guide.
 * Uses jose for Edge + Node compatible JWT (HS256).
 * Demo: plain passwords in user store (NOT for production).
 */

import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { User } from "./types";

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-n8nlike-insecure-change-in-prod-2026";
const encodedKey = new TextEncoder().encode(SESSION_SECRET);

export interface SessionPayload {
  userId: string;
  email: string;
  expiresAt: string; // ISO
}

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

export async function decrypt(session: string | undefined = ""): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch (error) {
    // invalid/expired
    return null;
  }
}

export async function createSession(user: User): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    expiresAt: expiresAt.toISOString(),
  };
  const session = await encrypt(payload);
  const cookieStore = await cookies();

  cookieStore.set("session", session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "lax",
    path: "/",
  });
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("session");
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  let session = cookieStore.get("session")?.value;
  if (!session) {
    // Robust fallback: proxy may set x-user-id header (for optimistic/edge cases); reconstruct minimal session
    try {
      const h = await headers();
      const uid = h.get("x-user-id");
      const email = h.get("x-user-email") || "";
      if (uid) {
        return { userId: uid, email, expiresAt: new Date(Date.now() + 86400000).toISOString() };
      }
    } catch {}
  }
  if (!session) return null;
  return decrypt(session);
}

// Convenience: returns minimal user info from session
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  return {
    id: session.userId,
    email: session.email,
  };
}
