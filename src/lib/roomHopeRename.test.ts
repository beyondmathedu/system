import { describe, it, expect } from "vitest";
import { buildRoomPageHref } from "@/lib/roomConstants";
import {
  DEFAULT_ROOM_DISPLAY_REGISTRY,
  formatRoomDisplayLabel,
} from "@/lib/roomDisplayRegistry";

describe("hope rename display", () => {
  it("shows Door/Shelf from default registry", () => {
    expect(formatRoomDisplayLabel("Hope", DEFAULT_ROOM_DISPLAY_REGISTRY)).toBe("Hope - Door");
    expect(formatRoomDisplayLabel("Hope 2", DEFAULT_ROOM_DISPLAY_REGISTRY)).toBe("Hope - Shelf");
    expect(formatRoomDisplayLabel("Hope - Door", DEFAULT_ROOM_DISPLAY_REGISTRY)).toBe("Hope - Door");
    expect(formatRoomDisplayLabel("Hope - Shelf", DEFAULT_ROOM_DISPLAY_REGISTRY)).toBe(
      "Hope - Shelf",
    );
  });

  it("builds room href from display or canonical labels", () => {
    expect(buildRoomPageHref("Hope")).toBe("/rooms/hope");
    expect(buildRoomPageHref("Hope - Door")).toBe("/rooms/hope");
    expect(buildRoomPageHref("Hope - Shelf")).toBe("/rooms/hope-2");
  });
});
