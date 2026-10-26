import { describe, expect, it } from "vitest";

describe("zoho token rate-limit detection", () => {
  function isRateLimitedTokenError(
    json: { error?: string; error_description?: string; status?: string },
    status: number,
  ): boolean {
    const blob = `${json.error ?? ""} ${json.error_description ?? ""} ${json.status ?? ""}`.toLowerCase();
    return (
      status === 429 ||
      blob.includes("too many requests") ||
      blob.includes("access denied") ||
      blob.includes("rate limit")
    );
  }

  it("detects the Zoho continuous-request denial", () => {
    expect(
      isRateLimitedTokenError(
        {
          error_description: "You have made too many requests continuously. Please try again after some time.",
          error: "Access Denied",
          status: "failure",
        },
        400,
      ),
    ).toBe(true);
  });
});
