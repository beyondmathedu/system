/** Shared portal login credential rules (client + server safe). */

export type CredentialOk<T extends string> = { ok: true; value: T };
export type CredentialErr = { ok: false; error: string };
export type CredentialResult<T extends string = string> = CredentialOk<T> | CredentialErr;

/**
 * Contact number = portal password.
 * Must be exactly 8 digits, no spaces or other symbols.
 */
export function validateStudentContactPhone(raw: string | null | undefined): CredentialResult {
  const original = String(raw ?? "");
  if (/\s/.test(original)) {
    return { ok: false, error: "Contact number must be exactly 8 digits with no spaces." };
  }
  const phone = original.trim();
  if (!phone) {
    return { ok: false, error: "Contact number is required (exactly 8 digits)." };
  }
  if (!/^\d{8}$/.test(phone)) {
    return {
      ok: false,
      error: "Contact number must be exactly 8 digits (no spaces or symbols).",
    };
  }
  return { ok: true, value: phone };
}

/**
 * Email = portal login id (except special student-id-only accounts).
 * Must include @ and look like a normal email.
 */
export function validateStudentEmailFormat(raw: string | null | undefined): CredentialResult {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "Email is required." };
  }
  if (/\s/.test(email)) {
    return { ok: false, error: "Email must not contain spaces." };
  }
  if (!email.includes("@")) {
    return { ok: false, error: "Email must include @." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email format is invalid." };
  }
  return { ok: true, value: email };
}

/** Portal password from contact number — only when phone passes the 8-digit rule. */
export function passwordFromContactNumber(raw: string | null | undefined): string | null {
  const result = validateStudentContactPhone(raw);
  return result.ok ? result.value : null;
}
