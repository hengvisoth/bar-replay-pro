<script setup lang="ts">
import ChartContainer from "./components/ChartContainer.vue";
import ScrubBar from "./components/ScrubBar.vue";
</script>

<template>
  <div class="flex flex-col w-screen h-screen bg-[#10141f] overflow-hidden">
    <div class="flex-1 relative overflow-hidden">
      <ChartContainer />
    </div>

    <div class="flex-none">
      <ScrubBar />
    </div>
  </div>
</template>
