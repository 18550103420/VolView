import { DataSource, DataSourceWithFile } from '@/src/io/import/dataSource';
import { useViewStore } from '@/src/store/views';
import {
    ImportContext,
    ImportHandler,
    ImportResult,
} from '@/src/io/import/common';
import { Layouts } from '@/src/config';
import { PipelineContext, PipelineResult } from '@/src/core/pipeline';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useLabelmapStore } from '@/src/store/datasets-labelmaps';
import { fetchFile } from '@/src/utils/fetch';
import AesTool from '@ruanwenfeng/aestool';
import { uploadToFDataStore } from '@/src/store/uploadToFData';
import { useToast } from '@/src/composables/useToast';
import { ToastID } from 'vue-toastification/dist/types/types';
import { useMessageStore } from '@/src/store/messages';
import { TYPE } from 'vue-toastification';
import { InputJsondata } from '../../../types/inputJson';

async function importOriginalFile(
    originalRemotes: DataSource[],
    { execute }: PipelineContext<DataSource, ImportResult, ImportContext>,
    toastID: ToastID | null,
    stateWithLabel: Boolean = false) {
    const stateIDToStoreID: Record<string, string> = {};

    // do the import
    const dicomSources: DataSourceWithFile[] = [];
    const processRequest = async (source: any) => 
        execute(source, { dicomDataSources: dicomSources });

    const importResults: PipelineResult<DataSource, ImportResult>[] = [];
    const limits = 20;
    const totalCount = originalRemotes.length;
    const limitedExcute = async () => {
        while (originalRemotes.length > 0) {
            const limitedDataSources = originalRemotes.splice(0, limits);
            const results = await Promise.all(
                limitedDataSources.map((r) => processRequest(r))
            );
            if (toastID != null) {
                const finishedCount = totalCount - originalRemotes.length;
                const percent = Math.round(finishedCount * 10000 / totalCount) / 100;
                useToast().update(toastID,
                    { content: `loading OriginalFile ${ percent }%...` }
                );
            }
            results.forEach((result) => {
                importResults.push(result);
            });
        }
    };
    await limitedExcute().catch((error) => {
        throw new Error("Error occurred:", error);
    });

    if (dicomSources.length) {
        const dicomStore = useDICOMStore();
        const volumeKeys = await dicomStore.importFiles(dicomSources);

        if (stateWithLabel) {
            if (volumeKeys.length !== 1) {
                throw new Error(`Obtained more than one volume from DICOM import:${volumeKeys.length}`);
            } else {
                const [key] = volumeKeys;
                // generate imageID so rulers and labelmaps can use stateIDToStoreID to setup there internal imageStore imageID references
                await dicomStore.buildVolume(key);
                stateIDToStoreID.dicom = key;
            }
        }
    }
    
    if (importResults.length) {
        importResults.forEach(i => {
            if (i.ok && i.data.length === 1) {
                stateIDToStoreID.nii = i.data[0].dataID || '';
            }
        })
    }
    return stateIDToStoreID;
}

async function getLabelFile(labelRemotes: DataSource) {
    const { uriSrc } = labelRemotes;
    if (uriSrc) {
        try {
            let file = await fetchFile(uriSrc.uri, uriSrc.name);
            if (uriSrc.encrypted) {
                await AesTool.init();
                const aesTool = new AesTool();
                const res = await aesTool.decryptFile(
                    new Uint8Array(await file.arrayBuffer())
                );
                if (res.toString() !== 'decryp file error') {
                    file = new File([res], uriSrc.name);
                } else {
                    // error
                    throw new Error(`ERROR ${res.toString()}`);
                }
            }
            return file;
        } catch (err) {
            throw new Error(`Could not download URL ${uriSrc.uri}`, {
                cause: err instanceof Error ? err : undefined,
            });
        }
    }
    return null;
}

/**
 * Reads inputJson from neuroblem.
 * @param dataSource
 * @returns
 */
const handleNeuroblemInput: ImportHandler = async (dataSource, { done, execute }) => {
    const { neuroSrc } = dataSource;
    if (neuroSrc) {
        const toast = useToast();
        const messageStore = useMessageStore();

        let loadingCount = 0;
        let toastID: ToastID | null = null;
        let error: Error | null = null;

        const resetState = () => {
            loadingCount = 0;
            toastID = null;
            error = null;
        };

        const startLoading = (Msg: String) => {
            loadingCount++;
            if (toastID === null) {
                toastID = toast.info(Msg, {
                    timeout: false,
                    closeButton: false,
                    closeOnClick: false,
                });
            }
            return toastID;
        };

        const stopLoading = (Msg: String) => {
            loadingCount--;
            if (loadingCount === 0 && toastID !== null) {
                if (error) {
                    toast.dismiss(toastID);
                    messageStore.addError('Some files failed to load', error);
                } else {
                    toast.update(toastID, {
                        content: Msg,
                        options: {
                            type: TYPE.SUCCESS,
                            timeout: 2000,
                            closeButton: 'button',
                            closeOnClick: true,
                        },
                    });
                }
                resetState();
            }
        };

        const originalRemotes: DataSource[] = [];
        const labelRemotes: DataSource[] = [];

        uploadToFDataStore().setPk(neuroSrc.resources[0].PkSubjectData)
        const baseURL = uploadToFDataStore().getInfo().baseUrl;

        neuroSrc.resources.forEach((remoteData: InputJsondata) => {
            const type = remoteData.Type.split(';');
            const fileExt = type[0];
            const fileType = type[1];
            const bEncrypted = remoteData.Type.includes('encrypted');
            remoteData.Url.forEach((u, idx) => {
                let fname = remoteData.Description;
                if (fileExt === 'dcm') {
                    fname += ` - ${idx + 1}.${fileExt}`;
                }
                if (fileType === 'original') {
                    originalRemotes.push({
                        uriSrc: {
                            uri: new URL(u, baseURL).href,
                            name: fname,
                            encrypted: bEncrypted,
                        },
                    });
                } else if (fileType === 'label') {
                    uploadToFDataStore().setLabelName(fname);
                    labelRemotes.push({
                        uriSrc: {
                            uri: new URL(u, baseURL).href,
                            name: fname,
                            encrypted: bEncrypted,
                        },
                    });
                }
            });
        });
        const stateWithLabel = labelRemotes.length > 0;
        startLoading("loading OriginalFile 0%...");
        const stateIDToStoreID = await importOriginalFile(originalRemotes, { execute, done } , toastID, stateWithLabel);
        // console.log(stateIDToStoreID);
        stopLoading("OriginalFile loaded!");

        useViewStore().setLayout(Layouts.Axial);

        if (stateWithLabel) {
            startLoading("loading LabelFile ...");
            // Restore the labelmaps
            labelRemotes.forEach(async lRemote => {
                const f = await getLabelFile(lRemote);
                if (f) {
                    useLabelmapStore().deserializeForFData(
                        f,
                        stateIDToStoreID
                    );
                }
            })
            stopLoading("LabelFile loaded!");
        }
        return done();
    }
    return dataSource;
};

export default handleNeuroblemInput;
