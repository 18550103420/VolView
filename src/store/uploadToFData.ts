import { defineStore } from 'pinia';

export const uploadToFDataStore = defineStore('uploadInfo', () => {
    const uploadInfo = {
        baseUrl: '',
        pk: '',
        labelName: '',
    }
  return {
    setPk(pk: string) {
        uploadInfo.pk = pk;
    },
    setBaseUrl(url: string) {
        uploadInfo.baseUrl = url;
    },
    setLabelName(name: string) {
      if (!name.includes('_nxvEdit')) {
        uploadInfo.labelName = name.replace('.nii.gz', '_nxvEdit.nii.gz');
      } else {
        uploadInfo.labelName = name;
      }
    },
    getInfo() {
      return uploadInfo;
    },
  };
});
