"use client";

export type LessonSaveKind = "year" | "records";

export type LessonSaveStatusEvent = {
  kind: LessonSaveKind;
  studentId: string;
  year?: number;
  status: "saving" | "saved" | "failed";
  message?: string;
};

const listeners = new Set<(event: LessonSaveStatusEvent) => void>();

export function subscribeLessonSaveStatus(listener: (event: LessonSaveStatusEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLessonSaveStatus(event: LessonSaveStatusEvent): void {
  for (const listener of listeners) listener(event);
}

const RETRY_DELAYS_MS = [1000, 3000] as const;

export async function withSaveRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay != null) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Save failed"));
}

export function saveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const raw = String(error ?? "").trim();
  return raw || "Save failed";
}
