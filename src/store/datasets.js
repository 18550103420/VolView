// import dicom from './dicom';
import { FileTypes } from '../io/io';
import { FileLoaded } from '../types';

export default ({ fileIO }) => ({
  namespaced: true,

  // modules: {
  //   dicom: dicom({ proxyManager, fileIO, dicomIO }),
  // },

  state: {},

  mutations: {},

  actions: {

    /**
     * Loads a list of File objects.
     *
     * @async
     * @param {File[]} files
     */
    async loadFiles({ dispatch }, files) {
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

      // for each regular file, use fileIO
      // wrap in try/catch or promise reject
      // if return type is not a vtk.js data object, then
      // set error condition

      const dicomFilesPromise = dispatch('dicom/importFiles', dicomFiles);

      const regularFilesPromise = Promise.allSettled(
        regularFiles.map((f) => fileIO.readSingleFile(f)),
      );

      const regularFilesLoaded = (await regularFilesPromise).map((r, i) => {
        switch (r.status) {
          case 'fulfilled':
            return FileLoaded.Success(regularFiles[i].name, r.value);
          case 'rejected':
            return FileLoaded.Failure(regularFiles[i].name, r.reason);
          default:
            return FileLoaded.Failure(
              regularFiles[i],
              new Error('loadFiles: Entered invalid state'),
            );
        }
      });

      let dicomFilesResult = null;
      try {
        await dicomFilesPromise;
        dicomFilesResult = FileLoaded.Success('DICOM', true);
      } catch (e) {
        dicomFilesResult = FileLoaded.Failure('DICOM', e);
      }

      return {
        fileResults: regularFilesLoaded,
        dicomResult: dicomFilesResult,
      };
    },
  },
});
