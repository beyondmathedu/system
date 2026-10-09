import { textbookPublisherDisplayName } from "@/lib/textbookPublisherCatalog";

export type StudentTextbookFields = {
  textbookPublisher: string;
  takesM1: boolean;
  takesM2: boolean;
  m1TextbookPublisher: string;
  m2TextbookPublisher: string;
};

export const EMPTY_STUDENT_TEXTBOOK_FIELDS: StudentTextbookFields = {
  textbookPublisher: "",
  takesM1: false,
  takesM2: false,
  m1TextbookPublisher: "",
  m2TextbookPublisher: "",
};

export function textbookFieldsFromStudentRow(data?: {
  textbook_publisher?: string | null;
  takes_m1?: boolean | null;
  takes_m2?: boolean | null;
  m1_textbook_publisher?: string | null;
  m2_textbook_publisher?: string | null;
} | null): StudentTextbookFields {
  if (!data) return { ...EMPTY_STUDENT_TEXTBOOK_FIELDS };
  return {
    textbookPublisher: data.textbook_publisher ?? "",
    takesM1: Boolean(data.takes_m1),
    takesM2: Boolean(data.takes_m2),
    m1TextbookPublisher: data.m1_textbook_publisher ?? "",
    m2TextbookPublisher: data.m2_textbook_publisher ?? "",
  };
}

export default function StudentTextbookSummary({
  textbookPublisher,
  takesM1 = false,
  takesM2 = false,
  m1TextbookPublisher = "",
  m2TextbookPublisher = "",
}: StudentTextbookFields) {
  return (
    <div className="min-w-0 w-full">
      <p className="text-xs font-semibold tracking-wider text-slate-500">Textbook publisher</p>
      <div className="mt-1 space-y-1 text-sm font-normal leading-5 text-slate-900">
        <p className="whitespace-normal break-words">
          <span className="font-bold">Compulsory:</span> {textbookPublisher || "—"}
        </p>
        {takesM1 ? (
          <p className="whitespace-normal break-words">
            <span className="font-bold">M1:</span>{" "}
            {textbookPublisherDisplayName(m1TextbookPublisher) || "—"}
          </p>
        ) : null}
        {takesM2 ? (
          <p className="whitespace-normal break-words">
            <span className="font-bold">M2:</span>{" "}
            {textbookPublisherDisplayName(m2TextbookPublisher) || "—"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
