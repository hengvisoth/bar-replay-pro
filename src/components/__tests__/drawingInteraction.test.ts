import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useDrawingStore } from "../../stores/drawingStore";
import { mount } from "@vue/test-utils";
import DrawingOverlay from "../DrawingOverlay.vue";
import type { TrendLineDrawing } from "../../data/drawings";

// Mock lightweight-charts
vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(),
}));

describe("Drawing Interaction", () => {
  let store: ReturnType<typeof useDrawingStore>;

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    store = useDrawingStore();
    // Setup minimal context
    store.setContext("ETHUSDT", "1h");
  });

  it("selects tool correctly", () => {
    store.setSelectedTool("trend-line");
    expect(store.activeTool).toBe("trend-line");
  });

  it("creates drawing via store actions", () => {
    store.setSelectedTool("trend-line");

    // Simulate adding points (as the Overlay would do)
    const p1 = { time: 1000, price: 100 };
    const p2 = { time: 2000, price: 200 };

    // Manually adding drawing to simulate "Finale"
    store.addDrawing({
      id: "test-1",
      type: "trend-line",
      pane: "main",
      points: [p1, p2],
      stroke: { color: "red", width: 1, style: "solid" },
      hidden: false,
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const drawings = store.drawingsByKey["ETHUSDT__1h"];
    expect(drawings).toHaveLength(1);

    // Type guard or cast
    const drawing = drawings[0];
    if (drawing.type === "trend-line") {
      expect((drawing as TrendLineDrawing).points).toHaveLength(2);
    } else {
      throw new Error("Wrong drawing type");
    }
  });

  it("handles undo/redo", () => {
    store.setSelectedTool("trend-line");
    store.addDrawing({
      id: "d1",
      type: "trend-line",
      pane: "main",
      points: [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
      ],
      stroke: { color: "red", width: 1, style: "solid" },
      hidden: false,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(store.currentDrawings).toHaveLength(1);

    store.undoLast();
    expect(store.currentDrawings).toHaveLength(0);

    store.redoLast();
    expect(store.currentDrawings).toHaveLength(1);
  });

  it("updates tool styles", () => {
    const initial = store.getToolStyle("trend-line");
    store.updateToolStyle("trend-line", { strokeColor: "#000000" });
    const updated = store.getToolStyle("trend-line");

    expect(updated.strokeColor).toBe("#000000");
    expect(initial.strokeColor).not.toBe("#000000");
  });
});
