import { defineStore } from "pinia";
import { ref } from "vue";

export const useUiStore = defineStore("ui", () => {
  const isRightPanelOpen = ref(true);

  function toggleRightPanel() {
    isRightPanelOpen.value = !isRightPanelOpen.value;
  }

  return {
    isRightPanelOpen,
    toggleRightPanel,
  };
});
