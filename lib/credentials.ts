import { v4 as uuidv4 } from "uuid";
import { Credential, CredentialType } from "./types";

const BASE_STORAGE_KEY = "n8nlike-credentials";
const MAX_RECORDS = 100;

function getCredStorageKey(userId?: string) {
  return userId ? `${BASE_STORAGE_KEY}-${userId}` : BASE_STORAGE_KEY;
}

/**
 * Shared credentials helpers (client + server in Next).
 * - encrypt/decrypt: demo (base64). Real: use proper crypto (AES) server-side with key from env.
 * - Client LS manager (mirrors lib/executions.ts).
 * - Dual mode: later when useApi, page will call /api/credentials instead of these.
 * Storage format always uses encryptedData in Credential.
 */

export function encryptCredentialData(plain: Record<string, any>): string {
  try {
    const json = JSON.stringify(plain || {});
    if (typeof window !== "undefined" && typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(json))); // browser safe
    }
    // Node / server - use globalThis to avoid bundler resolution issues in client bundles
    const Buf: any = (typeof globalThis !== "undefined" && (globalThis as any).Buffer) || (typeof Buffer !== "undefined" ? Buffer : undefined);
    if (Buf) return Buf.from(json, "utf8").toString("base64");
    return btoa(unescape(encodeURIComponent(json))); // last resort
  } catch {
    return "";
  }
}

export function decryptCredentialData(encrypted: string): Record<string, any> {
  try {
    let json: string;
    if (typeof window !== "undefined" && typeof atob === "function") {
      json = decodeURIComponent(escape(atob(encrypted || "")));
    } else {
      const Buf: any = (typeof globalThis !== "undefined" && (globalThis as any).Buffer) || (typeof Buffer !== "undefined" ? Buffer : undefined);
      if (Buf) {
        json = Buf.from(encrypted || "", "base64").toString("utf8");
      } else {
        json = atob ? decodeURIComponent(escape(atob(encrypted || ""))) : "{}";
      }
    }
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}

// --- Client LS functions (use encryptedData shape matching server) ---
export function saveCredential(cred: Omit<Credential, "id" | "createdAt" | "updatedAt"> & { id?: string; data?: Record<string, any> }, userId?: string): Credential {
  const now = new Date().toISOString();
  const dataToStore = cred.data || {};
  const encryptedData = (cred as any).encryptedData || encryptCredentialData(dataToStore);

  const full: Credential = {
    id: cred.id || `cred-${uuidv4().slice(0, 12)}`,
    name: cred.name || "Unnamed Credential",
    type: cred.type,
    encryptedData: encryptedData as any,
    platform: cred.platform,
    forNodeTypes: (cred as any).forNodeTypes || [],
    createdAt: cred.id ? (listCredentials(userId).find((c) => c.id === cred.id)?.createdAt || now) : now,
    updatedAt: now,
    userId,
  } as Credential;

  const existing = listCredentials(userId);
  const filtered = existing.filter((c) => c.id !== full.id);
  const updated = [full, ...filtered].slice(0, MAX_RECORDS);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(getCredStorageKey(userId), JSON.stringify(updated));
      // Also mirror to legacy BASE key for engine resolveCredentialAndAuth calls (no userId) from client runs; keeps compat + core engine no breakage
      if (userId) {
        localStorage.setItem(getCredStorageKey(undefined), JSON.stringify(updated));
      }
    }
  } catch (e) {
    console.warn("Failed to persist credential (quota/private mode)", e);
  }
  return full;
}

export function listCredentials(userId?: string): Credential[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(getCredStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function getCredential(id: string, userId?: string): Credential | null {
  return listCredentials(userId).find((c) => c.id === id) ?? null;
}

export function deleteCredential(id: string, userId?: string): void {
  try {
    const filtered = listCredentials(userId).filter((c) => c.id !== id);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(getCredStorageKey(userId), JSON.stringify(filtered));
    }
  } catch {}
}

export function clearCredentials(userId?: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(getCredStorageKey(userId));
    }
  } catch {}
}

/** Resolve and decrypt for execution use (returns plain data) */
export function resolveCredential(id?: string, userId?: string): Record<string, any> | null {
  if (!id) return null;
  const cred = getCredential(id, userId);
  if (!cred) return null;
  return decryptCredentialData(cred.encryptedData || "");
}

// --- Aliases for compatibility with UI code (page.tsx expects client* names + getDecryptedData) ---
export function listClientCredentials(userId?: string) { return listCredentials(userId); }
export function saveClientCredential(cred: any, userId?: string) { return saveCredential(cred, userId); }
export function deleteClientCredential(id: string, userId?: string) { return deleteCredential(id, userId); }
export function getClientCredential(id: string, userId?: string) { return getCredential(id, userId); }

export function getDecryptedData(credOrId: Credential | string | null | undefined, userId?: string): Record<string, any> {
  if (!credOrId) return {};
  if (typeof credOrId === "string") {
    const c = getCredential(credOrId, userId);
    return c ? decryptCredentialData(c.encryptedData || "") : {};
  }
  return decryptCredentialData(credOrId.encryptedData || "");
}

// Rich defs for UI forms (keys, labels, input types)
export const CREDENTIAL_TYPES = [
  {
    type: "apiKey" as CredentialType,
    label: "API Key",
    description: "Header or query key auth",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-..." },
      { key: "headerName", label: "Header Name", type: "text", placeholder: "X-API-Key" },
      { key: "prefix", label: "Prefix (optional)", type: "text", placeholder: "" },
    ],
  },
  {
    type: "basicAuth" as CredentialType,
    label: "Basic Auth",
    description: "username + password",
    fields: [
      { key: "username", label: "Username", type: "text", placeholder: "user" },
      { key: "password", label: "Password", type: "password", placeholder: "pass" },
    ],
  },
  {
    type: "oauth2" as CredentialType,
    label: "OAuth2 / Bearer",
    description: "Access token based",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password", placeholder: "ya29..." },
      { key: "tokenType", label: "Token Type", type: "text", placeholder: "Bearer" },
      { key: "clientId", label: "Client ID (optional)", type: "text", placeholder: "" },
    ],
  },
  {
    type: "generic" as CredentialType,
    label: "Generic / Custom",
    description: "Arbitrary fields",
    fields: [
      { key: "value", label: "Value / Token", type: "textarea", placeholder: "JSON or secret" },
    ],
  },
  {
    type: "smtp" as CredentialType,
    label: "SMTP / Email (Gmail etc)",
    description: "For email node real SMTP sends",
    fields: [
      { key: "smtpHost", label: "Host", type: "text", placeholder: "smtp.gmail.com" },
      { key: "smtpPort", label: "Port", type: "text", placeholder: "587" },
      { key: "smtpUser", label: "User", type: "text", placeholder: "you@gmail.com" },
      { key: "smtpPass", label: "Password / App Pass", type: "password", placeholder: "" },
      { key: "smtpSecure", label: "Secure (true/false)", type: "text", placeholder: "false" },
    ],
  },
];

// Aliases
export function getCredentialTypeDef(type: CredentialType) {
  return CREDENTIAL_TYPES.find((t) => t.type === type) || CREDENTIAL_TYPES[CREDENTIAL_TYPES.length - 1];
}

// Note: functions already exported above.
