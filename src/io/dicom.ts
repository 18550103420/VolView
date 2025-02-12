import { runPipeline, TextStream, InterfaceTypes, Image } from 'itk-wasm';

import {
  readDicomTags,
  readImageDicomFileSeries,
  setPipelinesBaseUrl,
  setPipelineWorkerUrl,
} from '@itk-wasm/dicom';

import itkConfig from '@/src/io/itk/itkConfig';
// import { record } from 'zod';

export interface TagSpec {
  name: string;
  tag: string;
}

export type SpatialParameters = Pick<
  Image,
  'size' | 'spacing' | 'origin' | 'direction'
>;

// volume ID => file names
export type VolumesToFileNamesMap = Record<string, string[]>;

// volume ID => files
export type VolumesToFilesMap = Record<string, File[]>;

/**
 * Filenames must be sanitized prior to being passed into itk-wasm.
 *
 * In particular, forward slashes cause FS errors in itk-wasm.
 * @param name
 * @returns
 */
function sanitizeFileName(name: string) {
  return name.replace(/\//g, '_');
}

/**
 * Returns a new File instance with a sanitized name.
 * @param file
 */
function sanitizeFile(file: File) {
  return new File([file], sanitizeFileName(file.name));
}

export class DICOMIO {
  private webWorker: any;
  private initializeCheck: Promise<void> | null;

  constructor() {
    this.webWorker = null;
    this.initializeCheck = null;
  }

  private async runTask(
    module: string,
    args: any[],
    inputs: any[],
    outputs: any[]
  ) {
    return runPipeline(this.webWorker, module, args, outputs, inputs, {
      pipelineBaseUrl: itkConfig.pipelinesUrl,
      pipelineWorkerUrl: itkConfig.pipelineWorkerUrl,
    });
  }

  /**
   * Helper that initializes the webworker.
   *
   * @async
   * @throws Error initialization failed
   */
  async initialize() {
    if (!this.initializeCheck) {
      setPipelinesBaseUrl(itkConfig.pipelinesUrl);
      setPipelineWorkerUrl(itkConfig.pipelineWorkerUrl);
      this.initializeCheck = new Promise<void>((resolve, reject) => {
        this.runTask('dicom', [], [], [])
          .then((result) => {
            if (result.webWorker) {
              this.webWorker = result.webWorker;
            } else {
              reject(new Error('Could not initialize webworker'));
            }
          })
          .then(async () => {
            // preload read-dicom-tags pipeline
            try {
              await readDicomTags(this.webWorker, new File([], ''));
            } catch {
              // ignore
            }
            resolve();
          })
          .catch(reject);
      });
    }

    return this.initializeCheck;
  }

  /**
   * Categorize files
   * @async
   * @param {File[]} files
   * @returns volumeID => file names mapping
   */
  async categorizeFiles(files: File[]): Promise<VolumesToFilesMap> {
    await this.initialize();

    const inputs = await Promise.all(
      files.map(async (file, index) => {
        const buffer = await file.arrayBuffer();
        return {
          type: InterfaceTypes.BinaryFile,
          data: {
            path: index.toString(), // make each file name unique
            data: new Uint8Array(buffer),
          },
        };
      })
    );

    const args = [
      '--action',
      'categorize',
      '--memory-io',
      '0',
      '--files',
      ...inputs.map((fd) => fd.data.path),
    ];

    const outputs = [{ type: InterfaceTypes.TextStream }];

    const result = await this.runTask('dicom', args, inputs, outputs);

    // File names are indexes into input files array
    const volumeToFileIndexes = JSON.parse(
      (result.outputs[0].data as TextStream).data
    ) as VolumesToFileNamesMap;

    // Check NumberOfFrame
    const vtfi:VolumesToFileNamesMap = {};

    // const promises = 
    await Promise.all(Object.entries(volumeToFileIndexes).map(async ([vkey, fileIndexes]) => {
      // console.log(`vkey:${vkey}`);
      const nofTag = await this.readTags(sanitizeFile(files[parseInt(fileIndexes[0], 10)]),
        [{ name: 'NumberOfFrame', tag: '0028|0008', strconv: true }]);
      if (nofTag.NumberOfFrame.length > 0) {
        // console.log(`NumberOfFrame:${nofTag.NumberOfFrame}`);
        
        if (fileIndexes.length > 0) {
          fileIndexes.forEach(idx => {
            vtfi[vkey + idx] = [idx];
          })
        }
      } else {
        vtfi[vkey] = fileIndexes;
      }
    }));

    // for (const p of promises) {
    //   await p;
    // }

    const volumeToFiles = Object.fromEntries(
      Object.entries(vtfi).map(([volumeKey, fileIndexes]) => [
        volumeKey,
        // file indexes to Files
        fileIndexes.map((fileIndex) => files[parseInt(fileIndex, 10)]),
      ])
    );

    return volumeToFiles;
  }

  /**
   * Reads a list of tags out from a given file.
   *
   * @param {File} file
   * @param {[]Tag} tags
   */
  async readTags<T extends TagSpec[]>(
    file: File,
    tags: T
  ): Promise<Record<T[number]['name'], string>> {
    const tagsArgs = { tagsToRead: { tags: tags.map(({ tag }) => tag) } };

    const result = await readDicomTags(
      this.webWorker,
      sanitizeFile(file),
      tagsArgs
    );
    const tagValues = new Map(result.tags);

    return tags.reduce((info, t) => {
      const { tag, name } = t;
      if (tagValues.has(tag)) {
        return { ...info, [name]: tagValues.get(tag) };
      }
      return info;
    }, {} as Record<T[number]['name'], string>);
  }

  /**
   * Retrieves a slice of a volume.
   * @async
   * @param {File} file containing the slice
   * @param {Boolean} asThumbnail cast image to unsigned char. Defaults to false.
   * @returns ItkImage
   */
  async getVolumeSlice(file: File, asThumbnail: boolean = false) {
    await this.initialize();

    const buffer = await file.arrayBuffer();

    const inputs = [
      {
        type: InterfaceTypes.BinaryFile,
        data: {
          path: sanitizeFileName(file.name),
          data: new Uint8Array(buffer),
        },
      },
    ];

    const args = [
      '--action',
      'getSliceImage',
      '--thumbnail',
      asThumbnail.toString(),
      '--file',
      sanitizeFileName(file.name),
      '--memory-io',
      '0',
    ];

    const outputs = [{ type: InterfaceTypes.Image }];

    const result = await this.runTask('dicom', args, inputs, outputs);

    return result.outputs[0].data as Image;
  }

  async resample(fixed: SpatialParameters, moving: Image) {
    await this.initialize();

    const { size, spacing, origin, direction } = fixed;
    const args = [
      '--action',
      'resample',
      '0', // space for input image

      '--size',
      size.join(','),
      '--spacing',
      spacing.join(','),
      '--origin',
      origin.join(','),
      '--direction',
      direction.join(','),

      '--memory-io',
      '0',
    ];

    const inputs = [{ type: InterfaceTypes.Image, data: moving }];
    const outputs = [{ type: InterfaceTypes.Image }];

    const result = await this.runTask('dicom', args, inputs, outputs);
    const image = result.outputs[0].data as Image;
    return image;
  }

  /**
   * Builds a volume for a set of files.
   * @async
   * @param {File[]} seriesFiles the set of files to build volume from
   * @returns ItkImage
   */
  async buildImage(seriesFiles: File[]) {
    await this.initialize();

    const inputImages = seriesFiles.map((file) => sanitizeFile(file));
    const result = await readImageDicomFileSeries(null, {
      inputImages,
      singleSortedSeries: false,
    });

    return result.outputImage;
  }
}
