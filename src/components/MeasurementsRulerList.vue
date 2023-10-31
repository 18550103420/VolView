<script setup lang="ts">
import MeasurementsToolList from '@/src/components/MeasurementsToolList.vue';
import { useRulerStore } from '@/src/store/tools/rulers';

const toolStore = useRulerStore();
const jumpTo = (id: string) => {
  toolStore.jumpToTool(id);
};
</script>

<template>
  <measurements-tool-list :toolStore="toolStore" icon="mdi-ruler">
    <template v-slot:details="{ tool }">
      <v-row>
        <v-col @click="jumpTo(tool.id)">
          <v-tooltip location="top" activator="parent">Reveal Slice</v-tooltip>
          Slice: {{ tool.slice + 1 }}</v-col>
        <!-- <v-col>Axis: {{ tool.axis }}</v-col> -->
        <v-col>
          <!-- Length: -->
          <span class="value">
            {{ toolStore.lengthByID[tool.id].toFixed(2) }}mm
          </span>
        </v-col>
      </v-row>
    </template>
  </measurements-tool-list>
</template>
