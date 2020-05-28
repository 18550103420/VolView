import { NO_SELECTION } from '@/src/constants';

import dicom from './dicom';
import visualization from './visualization';
import { FileTypes } from '../io/io';
import { isVtkObject } from '../utils/common';

export const DataTypes = {
  Image: 'Image',
  Dicom: 'DICOM',
  Model: 'Model',
};

export default (dependencies) => ({
  namespaced: true,

  modules: {
    dicom: dicom(dependencies),
    visualization: visualization(dependencies),
  },

  state: {
    data: {
      nextID: 1,
      index: {},
      imageIDs: [],
      dicomIDs: [],
      vtkCache: {},
    },

    // track the mapping from seriesUID to data ID
    dicomSeriesToID: {},

    selectedBaseImage: NO_SELECTION,
    baseMetadata: {
      spacing: [1, 1, 1],
      // identity
      worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
  },

  mutations: {
    /**
     * Args: { image, name }
     */
    addImage(state, { name, image }) {
      const id = state.data.nextID;
      state.data.nextID += 1;
      state.data.vtkCache[id] = image;
      state.data.imageIDs.push(id);
      state.data.index = {
        ...state.data.index,
        [id]: {
          type: DataTypes.Image,
          name,
        },
      };
    },

    /**
     * Args: { patientKey, studyKey, seriesKey }
     */
    addDicom(state, { patientKey, studyKey, seriesKey }) {
      const id = state.data.nextID;
      state.data.nextID += 1;
      // save seriesKey -> id mapping
      state.dicomSeriesToID = {
        ...state.dicomSeriesToID,
        [seriesKey]: id,
      };
      state.data.dicomIDs.push(id);
      state.data.index = {
        ...state.data.index,
        [id]: {
          type: DataTypes.Dicom,
          patientKey,
          studyKey,
          seriesKey,
        },
      };
    },

    setBaseImage(state, id) {
      state.selectedBaseImage = id;
    },

    cacheDicomImage(state, { seriesKey, image }) {
      const id = state.dicomSeriesToID[seriesKey];
      state.data.vtkCache[id] = image;
    },

    setBaseMetadata(state, { spacing, worldToIndex }) {
      state.baseMetadata.spacing = [...spacing];
      state.baseMetadata.worldToIndex = [...worldToIndex];
    },
  },

  actions: {

    /**
     * Loads a list of File objects.
     *
     * @async
     * @param {File[]} files
     */
    async loadFiles({ dispatch }, files) {
      const { fileIO } = dependencies;

      const dicomFiles = [];
      const regularFiles = [];

      const fileTypesP = files.map(async (file) => fileIO.getFileType(file));
      const fileTypes = await Promise.all(fileTypesP);
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const type = fileTypes[i];
        if (type === FileTypes.DICOM) {
          dicomFiles.push(file);
        } else {
          regularFiles.push(file);
        }
      }

      const errors = await Promise.all([
        dispatch('loadDicomFiles', dicomFiles),
        dispatch('loadRegularFiles', regularFiles),
      ]);

      return [].concat(...errors);
    },

    async loadDicomFiles({ state, commit, dispatch }, files) {
      const errors = [];
      try {
        const updatedSeriesKeys = await dispatch('dicom/importFiles', files);
        updatedSeriesKeys.forEach((keys) => {
          if (!(keys.seriesKey in state.dicomSeriesToID)) {
            commit('addDicom', {
              patientKey: keys.patientKey,
              studyKey: keys.studyKey,
              seriesKey: keys.seriesKey,
            });
          }
        });
      } catch (e) {
        errors.push({
          name: 'DICOM files',
          error: e,
        });
      }
      return errors;
    },

    async loadRegularFiles({ commit }, files) {
      const { fileIO } = dependencies;

      const loadResults = await Promise.allSettled(
        files.map((f) => fileIO.readSingleFile(f)),
      );

      const errors = [];
      loadResults.forEach((r, i) => {
        switch (r.status) {
          case 'fulfilled': {
            const obj = r.value;
            const { name } = files[i];
            if (isVtkObject(obj)) {
              if (obj.isA('vtkImageData')) {
                commit('addImage', {
                  name,
                  image: obj,
                });
              }
            } else {
              errors.push({
                name,
                error: new Error('loadRegularFiles: Read file is not a VTK object'),
              });
            }
            break;
          }

          case 'rejected':
            errors.push({
              name: files[i].name,
              error: r.reason,
            });
            break;

          default:
            errors.push({
              name: files[i].name,
              error: new Error('loadRegularFiles: Invalid allSettled state'),
            });
        }
      });

      return errors;
    },

    /**
     * Selects a base image.
     *
     * If the dataset is not an image or NO_SELECTION,
     * then the selection will be cleared.
     */
    async selectBaseImage({ state, dispatch, commit }, id) {
      let baseImageId = NO_SELECTION;
      if (
        id in state.data.index && (
          state.data.index[id].type === DataTypes.Image
          || state.data.index[id].type === DataTypes.Dicom
        )
      ) {
        baseImageId = id;
      }

      commit('setBaseImage', baseImageId);

      if (baseImageId !== NO_SELECTION) {
        let imageData;

        if (!(baseImageId in state.data.vtkCache)) {
          if (state.data.index[baseImageId].type === DataTypes.Dicom) {
            const { seriesKey } = state.data.index[baseImageId];
            imageData = await dispatch('dicom/buildSeriesVolume', seriesKey);
            commit('cacheDicomImage', {
              seriesKey,
              image: imageData,
            });
          } else {
            throw new Error('selectBaseImage: no VTK data for selection');
          }
        } else {
          imageData = state.data.vtkCache[baseImageId];
        }

        const spacing = imageData.getSpacing();
        const worldToIndex = imageData.getWorldToIndex();

        commit('setBaseMetadata', {
          spacing,
          worldToIndex,
        });
      }

      await dispatch('updateRenderPipeline');
    },
  },
});
