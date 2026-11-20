// The hover morph's anchor must match the table in placement.rs (hover_grows_away_from_the_morph_anchor).
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/native", () => ({ http: vi.fn(), native: {}, openExternal: vi.fn(), secrets: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), emitTo: vi.fn(), listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: vi.fn(), onFocusChanged: vi.fn(async () => () => undefined) }) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: vi.fn(async () => undefined) }) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { MORPH_MS, hitRect, morphAnchor, sizeFor } from "./NotchApp";

describe("clip to the tab inside the card-sized window", () => {
  const card = { w: 340, h: 84 };
  const tab = { w: 112, h: 44 };
  it("top right: the tab is in the top-right corner", () => {
    expect(hitRect(morphAnchor("island", "right", "topRight"), card, tab)).toEqual({ x: 228, y: 0, w: 112, h: 44 });
  });
  it("bottom left: the tab is in the bottom-left corner", () => {
    expect(hitRect(morphAnchor("island", "right", "bottomLeft"), card, tab)).toEqual({ x: 0, y: 40, w: 112, h: 44 });
  });
  it("top centre: the tab is centred", () => {
    expect(hitRect(morphAnchor("island", "right", "top"), card, tab)).toEqual({ x: 114, y: 0, w: 112, h: 44 });
  });
  it("edge right: the tab hugs the right edge", () => {
    expect(hitRect(morphAnchor("edge", "right", "top"), { w: 316, h: 96 }, { w: 50, h: 96 })).toEqual({ x: 266, y: 0, w: 50, h: 96 });
  });
});

describe("hover morph", () => {
  it.each([
    ["edge", "right", "top", "right", "top"],
    ["edge", "left", "top", "left", "top"],
    ["island", "right", "topLeft", "left", "top"],
    ["island", "right", "top", "center", "top"],
    ["island", "right", "topRight", "right", "top"],
    ["island", "right", "bottomLeft", "left", "bottom"],
    ["island", "right", "bottomRight", "right", "bottom"],
  ] as const)("%s %s %s grows from %s/%s", (style, edge, island, x, y) => {
    expect(morphAnchor(style, edge, island)).toEqual({ x, y });
  });

  it("uses the sizes the Rust test assumes", () => {
    expect(sizeFor("collapsed", "edge", false)).toEqual({ w: 50, h: 96 });
    expect(sizeFor("peek", "edge", false)).toEqual({ w: 316, h: 96 });
    expect(sizeFor("collapsed", "island", false)).toEqual({ w: 112, h: 44 });
    expect(sizeFor("peek", "island", false)).toEqual({ w: 340, h: 84 });
  });

  it("waits as long as the CSS transition (0.22s)", () => {
    expect(MORPH_MS).toBe(220);
  });
});
