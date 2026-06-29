"use client";

import { useMemo, useState } from "react";
import {
  formatTextbookPublisherValue,
  getTextbookCatalog,
  gradeToTextbookBand,
  resolveTextbookSelection,
  type TextbookBook,
} from "@/lib/textbookPublisherCatalog";

type Props = {
  grade: string;
  value: string;
  onChange: (value: string) => void;
};

const PUBLISHER_BTN =
  "rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d76c2]/40";
const PUBLISHER_IDLE = "border-[#1d76c2]/30 bg-[#1d76c2]/5 text-[#1d76c2] hover:bg-[#1d76c2]/10";
const PUBLISHER_ACTIVE = "border-[#1d76c2] bg-[#1d76c2] text-white shadow-sm";

const BOOK_BTN =
  "rounded-lg border px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50";
const BOOK_IDLE = "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50";
const BOOK_ACTIVE = "border-[#1d76c2] bg-[#1d76c2]/5 text-[#1d76c2] ring-1 ring-[#1d76c2]/30";

export default function TextbookPublisherPicker({ grade, value, onChange }: Props) {
  const band = gradeToTextbookBand(grade);
  const catalog = useMemo(() => (band ? getTextbookCatalog(band) : []), [band]);

  const resolved = useMemo(
    () => resolveTextbookSelection(grade, value),
    [grade, value],
  );

  const [publisherDraft, setPublisherDraft] = useState<string | null>(null);
  const resetKey = `${band ?? ""}::${resolved.publisher}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPublisherDraft(null);
  }
  const selectedPublisher = resolved.publisher || publisherDraft;

  const booksForPublisher = useMemo(() => {
    if (!selectedPublisher) return [];
    return catalog.find((g) => g.publisher === selectedPublisher)?.books ?? [];
  }, [catalog, selectedPublisher]);

  function selectPublisher(publisher: string) {
    setPublisherDraft(publisher);
    const parsed = resolveTextbookSelection(grade, value);
    if (parsed.publisher === publisher && parsed.book) {
      onChange(formatTextbookPublisherValue(publisher, parsed.book));
    } else {
      onChange("");
    }
  }

  function selectBook(book: TextbookBook) {
    if (!selectedPublisher) return;
    onChange(formatTextbookPublisherValue(selectedPublisher, book));
  }

  const selectedBook = resolved.book;

  if (!band) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-slate-700">Textbook publisher</span>
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Please select a grade (F.1–F.6) first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 md:col-span-2 xl:col-span-3">
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-700">Textbook publisher</p>
        <p className="mb-2 text-xs text-slate-500">
          {band === "junior" ? "F.1–F.3" : "F.4–F.6"} — choose publisher
        </p>
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

      {selectedPublisher ? (
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

      {value ? (
        <p className="text-xs text-slate-600">
          Selected: <span className="font-medium text-slate-800">{value}</span>
        </p>
      ) : null}
    </div>
  );
}
