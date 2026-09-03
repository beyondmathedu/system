import { describe, expect, it } from "vitest";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";

describe("formatStudentDisplayName compact", () => {
  it("shows nickname when set", () => {
    expect(
      formatStudentDisplayName(
        { id: "00007", name_zh: "徐洛悠", name_en: "Tsui Lok Yau", nickname_en: "Ashley" },
        "compact",
      ),
    ).toBe("徐洛悠 Ashley");
  });

  it("falls back to single-word English name when nickname is empty", () => {
    expect(
      formatStudentDisplayName(
        { id: "00160", name_zh: "朱翠頤", name_en: "Ashley", nickname_en: null },
        "compact",
      ),
    ).toBe("朱翠頤 Ashley");
  });

  it("omits multi-word English name without nickname in compact cells", () => {
    expect(
      formatStudentDisplayName(
        { id: "00999", name_zh: "測試", name_en: "Tsui Lok Yau", nickname_en: null },
        "compact",
      ),
    ).toBe("測試");
  });
});
