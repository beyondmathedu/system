"use client";

import { useMemo, useState } from "react";
import {
  formatTextbookPublisherValue,
  getExtendedMathsCatalog,
  getTextbookCatalog,
  gradeToTextbookBand,
  resolveExtendedMathsTextbookSelection,
  resolveTextbookSelection,
  type TextbookBook,
} from "@/lib/textbookPublisherCatalog";

type Props = {
  grade?: string;
  value: string;
  onChange: (value: string) => void;
  variant?: "grade" | "extended";
  title?: string;
  hint?: string;
  className?: string;
  badge?: string;
};

const PUBLISHER_BTN =
  "rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d76c2]/40";
const PUBLISHER_IDLE = "border-[#1d76c2]/30 bg-[#1d76c2]/5 text-[#1d76c2] hover:bg-[#1d76c2]/10";
const PUBLISHER_ACTIVE = "border-[#1d76c2] bg-[#1d76c2] text-white shadow-sm";

const BOOK_BTN =
  "rounded-lg border px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50";
const BOOK_IDLE = "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50";
const BOOK_ACTIVE = "border-[#1d76c2] bg-[#1d76c2]/5 text-[#1d76c2] ring-1 ring-[#1d76c2]/30";

export default function TextbookPublisherPicker({
  grade = "",
  value,
  onChange,
  variant = "grade",
  title,
  hint,
  className,
  badge,
}: Props) {
  const isExtended = variant === "extended";
  const band = isExtended ? null : gradeToTextbookBand(grade);
  const catalog = useMemo(
    () => (isExtended ? getExtendedMathsCatalog() : band ? getTextbookCatalog(band) : []),
    [band, isExtended],
  );

  const resolved = useMemo(
    () =>
      isExtended
        ? resolveExtendedMathsTextbookSelection(value)
        : resolveTextbookSelection(grade, value),
    [grade, isExtended, value],
  );

  const [publisherDraft, setPublisherDraft] = useState<string | null>(null);
  const catalogKey = isExtended ? "extended" : (band ?? "");
  const [lastCatalogKey, setLastCatalogKey] = useState(catalogKey);
  if (catalogKey !== lastCatalogKey) {
    setLastCatalogKey(catalogKey);
    setPublisherDraft(null);
  }
  const selectedPublisher = publisherDraft || resolved.publisher;

  const booksForPublisher = useMemo(() => {
    if (!selectedPublisher) return [];
    return catalog.find((g) => g.publisher === selectedPublisher)?.books ?? [];
  }, [catalog, selectedPublisher]);

  function selectPublisher(publisher: string) {
    setPublisherDraft(publisher);
    const books = catalog.find((g) => g.publisher === publisher)?.books ?? [];
    if (books.length === 1 && books[0]) {
      onChange(formatTextbookPublisherValue(publisher, books[0]));
      return;
    }
    if (resolved.publisher === publisher && resolved.book) {
      onChange(formatTextbookPublisherValue(publisher, resolved.book));
    } else {
      onChange("");
    }
  }

  function selectBook(book: TextbookBook) {
    if (!selectedPublisher) return;
    onChange(formatTextbookPublisherValue(selectedPublisher, book));
  }

  const selectedBook = resolved.book;

  const heading = title ?? "Textbook publisher";
  const subhint =
    hint ??
    (isExtended
      ? "Choose the Maths Extended textbook used on the M1/M2 progress sheet"
      : band === "junior"
        ? "Compulsory Maths · F.1–F.3 publishers"
        : "Compulsory Maths · F.4–F.6 publishers");

  const headingBlock = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {badge ? (
        <span className="inline-flex items-center rounded-md bg-[#1d76c2] px-2 py-0.5 text-xs font-bold tracking-wide text-white">
          {badge}
        </span>
      ) : null}
      <p className="text-sm font-bold text-slate-900">{heading}</p>
      <span className="text-xs font-medium text-slate-500">Optional</span>
    </div>
  );

  if (!isExtended && !band) {
    return (
      <div className={className ?? "flex flex-col gap-1 md:col-span-2 xl:col-span-3"}>
        {headingBlock}
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Please select a grade (F.1–F.6) first.
        </p>
      </div>
    );
  }

  return (
    <div className={className ?? "flex flex-col gap-3 md:col-span-2 xl:col-span-3"}>
      <div>
        {headingBlock}
        <p className="mb-2 text-xs text-slate-500">{subhint}</p>
        <div className="flex flex-wrap gap-2">
          {catalog.map((group) => {
            const active = selectedPublisher === group.publisher;
            return (
              <button
                key={group.publisher}
                type="button"
                className={`${PUBLISHER_BTN} ${active ? PUBLISHER_ACTIVE : PUBLISHER_IDLE}`}
                onClick={() => selectPublisher(group.publisher)}
              >
                {group.publisher}
              </button>
            );
          })}
        </div>
      </div>

      {!isExtended && selectedPublisher && booksForPublisher.length > 1 ? (
        <div>
          <p className="mb-2 text-xs text-slate-500">Choose textbook ({selectedPublisher})</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {booksForPublisher.map((book) => {
              const active = selectedBook?.title === book.title;
              return (
                <button
                  key={book.title}
                  type="button"
                  className={`${BOOK_BTN} ${active ? BOOK_ACTIVE : BOOK_IDLE}`}
                  onClick={() => selectBook(book)}
                >
                  {book.title}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {!isExtended ? (
        value ? (
          <p className="text-xs text-slate-600">
            Selected: <span className="font-medium text-slate-800">{value}</span>
          </p>
        ) : (
          <p className="text-xs text-slate-400">No textbook selected (optional)</p>
        )
      ) : null}
    </div>
  );
}
