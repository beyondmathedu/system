import { describe, expect, it } from "vitest";
import {
  F6_BY_TOPICS_CHAPTERS,
  applyF6ByTopicsChapters,
} from "@/lib/studentProgressF6ByTopicsChapters";

describe("applyF6ByTopicsChapters", () => {
  it("writes canonical EN/ZH chapters into every textbook pair", () => {
    const sheet = applyF6ByTopicsChapters({
      name: "F6 By Topics",
      headers: [
        "",
        "Textbook: Maths Smart",
        "Textbook: Maths Smart",
        "Textbook: New Century",
        "Textbook: New Century",
        "Basic Concept",
      ],
      rows: [
        ["F.6", "old en", "old zh", "old en2", "old zh2"],
        ["Remedial", "", "", "", "", "Still need improvement"],
      ],
    });

    expect(sheet.rows).toHaveLength(F6_BY_TOPICS_CHAPTERS.length + 1);
    expect(sheet.rows[0]?.[0]).toBe("F.6");
    expect(sheet.rows[0]?.[1]).toBe("Factorization,Basic Equation Solving");
    expect(sheet.rows[0]?.[2]).toBe("因式分解，基本解方程");
    expect(sheet.rows[0]?.[3]).toBe("Factorization,Basic Equation Solving");
    expect(sheet.rows[0]?.[4]).toBe("因式分解，基本解方程");
    expect(sheet.rows[20]?.[1]).toBe("(Equation Straight Line)");
    expect(sheet.rows[20]?.[2]).toBe("(直線方程)");
    expect(sheet.rows[21]?.[0]).toBe("Remedial");
  });

  it("also applies to the F6 clone sheet", () => {
    const sheet = applyF6ByTopicsChapters({
      name: "F6",
      headers: ["", "Textbook: New Century", "Textbook: New Century", "Basic Concept"],
      rows: [["F.6", "x", "y"]],
    });
    expect(sheet.rows[0]?.[1]).toBe("Factorization,Basic Equation Solving");
    expect(sheet.rows).toHaveLength(F6_BY_TOPICS_CHAPTERS.length);
  });
});
