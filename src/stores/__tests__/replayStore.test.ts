import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useReplayStore } from "../replayStore";
import * as dataLoader from "../../services/dataLoader";
// import type { IndicatorType } from '../../data/types'; // Not used

// Mock data loader
vi.mock("../../services/dataLoader", () => ({
  fetchManifest: vi.fn(),
  loadCsvData: vi.fn(),
}));

describe("replayStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("should initialize with default state", () => {
    const store = useReplayStore();
    expect(store.activeSymbol).toBe("ETHUSDT");
    expect(store.activeTimeframe).toBe("1h");
    expect(store.isPlaying).toBe(false);
    expect(store.datasets).toEqual({});
  });

  it("scrolls data using shallowRef updates", async () => {
    const store = useReplayStore();

    const mockManifest = { ETHUSDT: { "1h": ["path/to/data.csv"] } };
    const mockData = [
      { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
      { time: 4600, open: 1.5, high: 2.5, low: 1, close: 2, volume: 200 },
      { time: 8200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 300 },
    ];

    (dataLoader.fetchManifest as any).mockResolvedValue(mockManifest);
    (dataLoader.loadCsvData as any).mockResolvedValue(mockData);

    await store.loadData();

    expect(store.currentReplayTime).toBe(8200);
    expect(store.visibleDatasets["1h"]).toHaveLength(3);

    store.setReplayStart(4600);
    expect(store.currentReplayTime).toBe(4600);

    expect(store.visibleDatasets["1h"]).toHaveLength(2);
    expect(store.visibleDatasets["1h"]?.[1]?.time).toBe(4600);
  });

  it("handles indicators correctly with shallowRef", async () => {
    const store = useReplayStore();

    const mockData = Array.from({ length: 20 }, (_, i) => ({
      time: i * 3600,
      open: 10 + i,
      high: 12 + i,
      low: 8 + i,
      close: 11 + i,
      volume: 100,
    }));

    (dataLoader.fetchManifest as any).mockResolvedValue({
      ETHUSDT: { "1h": ["data.csv"] },
    });
    (dataLoader.loadCsvData as any).mockResolvedValue(mockData);

    await store.loadData();

    // Trigger update via setReplayStart to ensure indicators are calculated
    store.setReplayStart(mockData[19].time);

    const indicators = store.visibleIndicators["1h"];
    expect(indicators).toBeDefined();
    expect(typeof indicators).toBe("object");
  });

  it("updates view on nextTick", async () => {
    const store = useReplayStore();
    // Mock 2 candles
    const mockData = [
      { time: 1000, close: 10 } as any,
      { time: 4600, close: 20 } as any,
    ];
    (dataLoader.fetchManifest as any).mockResolvedValue({
      ETHUSDT: { "1h": ["f.csv"] },
    });
    (dataLoader.loadCsvData as any).mockResolvedValue(mockData);

    await store.loadData();
    store.setReplayStart(1000);

    expect(store.visibleDatasets["1h"]).toHaveLength(1);

    store.stepForward();

    expect(store.currentReplayTime).toBe(4600);
    expect(store.visibleDatasets["1h"]).toHaveLength(2);
  });
});
