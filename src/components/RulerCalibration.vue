<script setup lang="ts">
import { useRulerStore } from '../store/tools/rulers';

const props = defineProps<{
  id: string;
}>();

const rulerStore = useRulerStore();
const newLength = rulerStore.lengthByID[props.id].toFixed(2);

defineEmits(['done']);
</script>

<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Calibration
    </v-card-title>

    <v-card-item>
      <div class="d-flex flex-row">
        <div class="flex-grow-1 d-flex flex-column justify-space-between mr-4">
          <div>
            <v-text-field
              v-model="newLength"
              @keydown.stop.enter="$emit('done', newLength)"
              label="NewLength (mm)"
              class="flex-grow-0"
            />
          </div>
          <v-card-actions class="mb-2 px-0">
            <v-btn color="secondary" variant="elevated" @click="$emit('done', newLength)">
              Done
            </v-btn>
          </v-card-actions>
        </div>
      </div>
    </v-card-item>
  </v-card>
</template>
