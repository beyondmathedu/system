"use client";

/** Spacer rows for virtualized HTML tables (keeps sticky columns working). */
export function VirtualTableSpacerRow({
  height,
  colSpan,
}: {
  height: number;
  colSpan: number;
}) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden="true">
      <td
        colSpan={colSpan}
        style={{
          height,
          padding: 0,
          border: "none",
          lineHeight: 0,
        }}
      />
    </tr>
  );
}
