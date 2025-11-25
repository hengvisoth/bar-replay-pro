// src/stores/replayStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { loadCsvData } from "../services/dataLoader";
import type { Candle } from "../data/types";

export const useReplayStore = defineStore("replay", () => {
  // --- STATE ---
  const allCandles = ref<Candle[]>([]); // The "Truth" (Full Dataset)
  const visibleCandles = ref<Candle[]>([]); // The "View" (What the chart sees)

  const isPlaying = ref(false);
  const playbackSpeed = ref(100); // ms delay between ticks
  const currentIndex = ref(0); // Pointer to where we are in the array

  // --- ACTIONS ---

  // 1. Load Data
  async function loadData() {
    // We are hardcoding the file path for this step
    const data = await loadCsvData(
      "ETHUSDT",
      "1h",
      "2024",
      "ETHUSDT-1h-2024-08.csv"
    );

    allCandles.value = data;

    // Reset Replay to start
    currentIndex.value = 0;
    updateView();
  }

  // 2. The "Tick" Function
  function nextTick() {
    if (currentIndex.value >= allCandles.value.length - 1) {
      isPlaying.value = false; // Stop at end
      return;
    }

    currentIndex.value++;
    updateView();
  }

  // 3. Update what the chart sees
  function updateView() {
    // In a real replay, we slice from 0 to currentIndex
    // This simulates "history growing"
    visibleCandles.value = allCandles.value.slice(0, currentIndex.value + 1);
  }

  // 4. Play/Pause Logic
  let intervalId: any = null;

  function togglePlay() {
    isPlaying.value = !isPlaying.value;

    if (isPlaying.value) {
      intervalId = setInterval(nextTick, playbackSpeed.value);
    } else {
      clearInterval(intervalId);
    }
  }

  return {
    allCandles,
    visibleCandles,
    isPlaying,
    loadData,
    togglePlay,
  };
});
