import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import { join, normalize } from '@/src/utils/path';
import { useIdStore } from '@/src/store/id';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { writeImageArrayBuffer } from 'itk-wasm'
import vtkLabelMap from '../vtk/LabelMap';
import { LABELMAP_PALETTE } from '../config';
import { StateFile, Manifest } from '../io/state-file/schema';
import { vtiReader, vtiWriter } from '../io/vtk/async';
import { FILE_READERS } from '../io';
import { FileEntry } from '../io/types';
import { findImageID, getDataID } from './datasets';
// import writeImageArrayBuffer from '../io/itk/writeImageArrayBuffer';
// import { usePaintToolStore } from './tools/paint';
import { uploadToFDataStore } from './uploadToFData';

const LabelmapArrayType = Uint8Array;
export type LabelmapArrayType = Uint8Array;

interface State {
  idList: string[];
  labelmaps: Record<string, vtkLabelMap>;
  parentImage: Record<string, string>;
}

function createLabelmapFromImage(imageData: vtkImageData) {
  const points = new LabelmapArrayType(imageData.getNumberOfPoints());
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction')
  );
  labelmap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: points,
    })
  );
  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();
  labelmap.setColorMap(LABELMAP_PALETTE);

  return labelmap;
}

function toLabelMap(imageData: vtkImageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get(
      'spacing',
      'origin',
      'direction',
      'indexToWorld',
      'worldToIndex',
      'dataDescription',
      'pointData'
    )
  );
  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();
  labelmap.setColorMap(LABELMAP_PALETTE);

  return labelmap;
}

export const useLabelmapStore = defineStore('labelmap', {
  state: (): State => ({
    idList: [],
    labelmaps: Object.create(null),
    parentImage: Object.create(null),
  }),
  actions: {
    newLabelmapFromImage(imageID: string) {
      const imageStore = useImageStore();
      const imageData = imageStore.dataIndex[imageID];
      if (!imageData) {
        return null;
      }

      const id = useIdStore().nextId();
      const labelmap = createLabelmapFromImage(imageData);

      this.idList.push(id);
      this.parentImage[id] = imageID;
      this.labelmaps[id] = labelmap;

      this.$proxies.addData(id, labelmap);

      return id;
    },
    async serialize(state: StateFile) {
      const { labelMaps } = state.manifest;
      const { zip } = state;

      await Promise.all(
        Object.entries(this.labelmaps).map(async ([id, labelMap]) => {
          const labelPath = `labels/${id}.vti`;
          const parent = getDataID(this.parentImage[id]);
          labelMaps.push({
            id,
            parent,
            path: labelPath,
          });

          const serializedData = await vtiWriter(labelMap);
          zip.file(labelPath, serializedData);
        })
      );
    },
    async deserialize(
      manifest: Manifest,
      stateFiles: FileEntry[],
      dataIDMap: Record<string, string>
    ) {
      const { labelMaps } = manifest;

      const labelmapIDMap: Record<string, string> = {};

      labelMaps.forEach(async (labelMap) => {
        const [file] = stateFiles
          .filter(
            (entry) =>
              join(entry.archivePath, entry.file.name) ===
              normalize(labelMap.path)
          )
          .map((entry) => entry.file);

        // map parent id to new id
        // eslint-disable-next-line no-param-reassign
        labelMap.parent = dataIDMap[labelMap.parent];

        const { parent } = labelMap;
        const id = useIdStore().nextId();
        labelmapIDMap[labelMap.id] = id;

        const imageData = await vtiReader(file);
        const labelMapObj = toLabelMap(imageData as vtkImageData);
        this.idList.push(id);
        this.parentImage[id] = findImageID(parent);
        this.labelmaps[id] = labelMapObj;
        this.$proxies.addData(id, labelMapObj);
      });

      return labelmapIDMap;
    },
    
    async serializeForFData(activeLabelmapID: String | null) {
      let file;
      await Promise.all(
        Object.entries(this.labelmaps).map(async ([id, labelMap]) => {
          // const serializedData = await niiWriter(labelMap);
          // console.log(serializedData);
          // if (id === usePaintToolStore().activeLabelmapID) {
          if (id === activeLabelmapID) {
            const uploadInfo = uploadToFDataStore().getInfo();
            // let labelName = `${uploadInfo.labelName}_nxEdit.nii.gz`;
            // const labelName = uploadInfo.labelName;
            const image = vtkITKHelper.convertVtkToItkImage(labelMap)
            image.data = image.data.slice(0);

            const direction = labelMap.getDirection(); // Transpose the direction matrix from column-major to row-major

            for (let idx = 0; idx < 3; ++idx) {
              for (let idy = 0; idy < 3; ++idy) {
                image.direction[idx + idy * 3] = direction[idx + idy * 3];
              }
            }
            // console.log(image.direction);
            await writeImageArrayBuffer(
              null,
              image,
              uploadInfo.labelName
            ).then((valueReturned) => {
              const buffer = valueReturned.arrayBuffer;
              const blob = new Blob([buffer]);
              file = new File([blob], uploadInfo.labelName);
              // console.log(file);
            })
          }
        })
      );
      return file;
    },
    async deserializeForFData(
      labelFile: File,
      dataIDMap: Record<string, string>
    ) {

      // const labelmapIDMap: Record<string, string> = {};
      const reader = FILE_READERS.get('application/gzip')!;
      const dataObject = await reader(labelFile);
      const labelMapObj = toLabelMap(dataObject as vtkImageData);

      if (dataIDMap.nii && dataIDMap.nii.length) {
        const id = useIdStore().nextId();
        this.idList.push(id);
        this.parentImage[id] = findImageID(dataIDMap.nii);
        this.labelmaps[id] = labelMapObj;
        // labelMapObj.setLabelColor(Number.parseInt(id), [255, 255, 0, 255]);
        this.$proxies.addData(id, labelMapObj);
      }
      if (dataIDMap.dicom && dataIDMap.dicom.length) {
        const id = useIdStore().nextId();
        this.idList.push(id);
        this.parentImage[id] = findImageID(dataIDMap.dicom);
        this.labelmaps[id] = labelMapObj;
        // labelMapObj.setLabelColor(Number.parseInt(id), [255, 255, 0, 255]);
        this.$proxies.addData(id, labelMapObj);
      }
      // return labelmapIDMap;
    },
  },
});
