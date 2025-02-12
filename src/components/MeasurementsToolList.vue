<script setup lang="ts" generic="ToolID extends string">
/* global ToolID:readonly */
import { computed, ref } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import RulerCalibration from './RulerCalibration.vue';

const props = defineProps<{
  toolStore: AnnotationToolStore<ToolID>;
  icon: string;
}>();

const { currentImageID, currentImageMetadata } = useCurrentImage();

const tools = computed(() => {
  const byID = props.toolStore.toolByID;
  return props.toolStore.toolIDs
    .map((id) => byID[id])
    .filter((tool) => !tool.placing && tool.imageID === currentImageID.value)
    .map((tool) => {
      const { axis } = frameOfReferenceToImageSliceAndAxis(
        tool.frameOfReference,
        currentImageMetadata.value,
        {
          allowOutOfBoundsSlice: true,
        }
      ) ?? { axis: 'unknown' };
      return {
        ...tool,
        axis,
      };
    });
});

const remove = (id: ToolID) => {
  props.toolStore.removeTool(id);
};

const calibrationDialog = ref(false);
const rulerID = ref();

const calibration = (id: ToolID, newLength: number) => {
  props.toolStore.calibrationTool(id, newLength);
};

// const jumpTo = (id: ToolID) => {
//   props.toolStore.jumpToTool(id);
// };
</script>

<template>
  <v-list-item v-for="tool in tools" :key="tool.id" lines="two">
    <template #prepend>
      <v-icon class="tool-icon">{{ icon }}</v-icon>
      <div class="color-dot mr-3" :style="{ backgroundColor: tool.color }" />
    </template>
    <v-list-item-title v-bind="$attrs">
      {{ tool.labelName }}
    </v-list-item-title>

    <v-list-item-subtitle>
      <slot name="details" v-bind="{ tool }">
        <v-row>
          <v-col>Slice: {{ tool.slice + 1 }}</v-col>
          <v-col>Axis: {{ tool.axis }}</v-col>
        </v-row>
      </slot>
    </v-list-item-subtitle>
    <template #append>
      <!-- <v-btn
        class="mr-2"
        icon="mdi-target"
        variant="text"
        @click="jumpTo(tool.id)"
      >
        <v-icon>mdi-target</v-icon>
        <v-tooltip location="top" activator="parent"> Reveal Slice </v-tooltip>
      </v-btn> 
     @click="calibration(tool.id)"
    -->
      <v-btn
        icon="mdi-pencil-ruler" 
        variant="text"
        @click.stop="
          () => {
            rulerID = tool.id;
            calibrationDialog = true;
          }
        "
      >
        <v-icon>mdi-pencil-ruler</v-icon>
        <v-tooltip location="top" activator="parent">Calibration</v-tooltip>
      </v-btn>
      <v-btn icon="mdi-delete" variant="text" @click="remove(tool.id)">
        <v-icon>mdi-delete</v-icon>
        <v-tooltip location="top" activator="parent">Delete</v-tooltip>
      </v-btn>
    </template>
  </v-list-item>

  <closeable-dialog v-model="calibrationDialog">
    <template v-slot="{ close }">
      <RulerCalibration
        @done="(newLength) => {
            calibration(rulerID, newLength);
            close();
          }
        "
        :id="rulerID"
      />
    </template>
  </closeable-dialog>
</template>

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
.empty-state {
  text-align: center;
}

.color-dot {
  width: 24px;
  height: 24px;
  background: yellow;
  border-radius: 16px;
}

.tool-icon {
  margin-inline-end: 12px;
}
</style>
