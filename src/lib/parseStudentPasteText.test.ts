import { describe, expect, it } from "vitest";
import {
  matchTextbookFromFreeText,
  parseStudentPasteBatch,
  parseStudentPasteText,
} from "@/lib/parseStudentPasteText";

describe("parseStudentPasteText", () => {
  it("parses enrollment sheet row (English name first, 中六, Chinese date)", () => {
    const result = parseStudentPasteText(
      "Lau tsun kit\tBosco\t2007年3月25日\t54071413\tboscolau02@gmail.com\t華德福會瑪利亞書院\t中六\t中文\txxpublisher\txxx",
    );
    expect(result.fields.nameEn).toBe("Lau tsun kit");
    expect(result.fields.nicknameEn).toBe("Bosco");
    expect(result.fields.birthDate).toBe("2007-03-25");
    expect(result.fields.studentPhone).toBe("54071413");
    expect(result.fields.email).toBe("boscolau02@gmail.com");
    expect(result.fields.school).toBe("華德福會瑪利亞書院");
    expect(result.fields.grade).toBe("F.6");
    expect(result.fields.mathLanguage).toBe("Chinese");
    expect(result.fields.textbookPublisher).toBeUndefined();
    expect(result.warnings.some((w) => /textbook/i.test(w))).toBe(true);
  });

  it("allows sparse rows without birth date", () => {
    const result = parseStudentPasteText("Chan Tai Man\tTom\t\t91234567\t\t聖保羅\t中三\t英文\t\t");
    expect(result.fields.nameEn).toBe("Chan Tai Man");
    expect(result.fields.nicknameEn).toBe("Tom");
    expect(result.fields.birthDate).toBeUndefined();
    expect(result.fields.studentPhone).toBe("91234567");
    expect(result.fields.grade).toBe("F.3");
    expect(result.fields.mathLanguage).toBe("English");
  });

  it("parses bilingual labeled lines", () => {
    const result = parseStudentPasteText(`
中文名: 王小明
英文名: Chan Tai Man
暱稱: Tom
年級: F.3
`);
    expect(result.fields.nameZh).toBe("王小明");
    expect(result.fields.grade).toBe("F.3");
  });

  it("maps 中文/英文 to Chinese/English in labeled lines", () => {
    expect(parseStudentPasteText("教學語言: 中文").fields.mathLanguage).toBe("Chinese");
    expect(parseStudentPasteText("授課語言: 英文").fields.mathLanguage).toBe("English");
  });
  it("parses multiple enrollment rows", () => {
    const batch = parseStudentPasteBatch(
      [
        "Lau tsun kit\tBosco\t2007年3月25日\t54071413\tboscolau02@gmail.com\t華德福會瑪利亞書院\t中六\t中文\t\t",
        "Chan Tai Man\tTom\t\t91234567\t\t聖保羅\t中三\t英文\t\t",
      ].join("\n"),
    );
    expect(batch.students).toHaveLength(2);
    expect(batch.students[0]?.fields.nameEn).toBe("Lau tsun kit");
    expect(batch.students[0]?.fields.grade).toBe("F.6");
    expect(batch.students[1]?.fields.nicknameEn).toBe("Tom");
    expect(batch.students[1]?.fields.grade).toBe("F.3");
    expect(batch.students[1]?.fields.birthDate).toBeUndefined();
    expect(batch.students[0]?.fields.mathLanguage).toBe("Chinese");
    expect(batch.students[1]?.fields.mathLanguage).toBe("English");
  });
});

describe("matchTextbookFromFreeText", () => {
  it("matches junior Oxford book", () => {
    expect(matchTextbookFromFreeText("F.2", "Oxford").value).toBe("Oxford · New Century");
  });

  it("skips placeholder publisher", () => {
    expect(matchTextbookFromFreeText("F.6", "xxpublisher").value).toBe("");
  });
});
