import { canFetchUrl, fetchFile } from '@/src/utils/fetch';
import { ImportHandler } from '@/src/io/import/common';
import AesTool from '@ruanwenfeng/aestool';

/**
 * Downloads a URL to a file DataSource.
 *
 * Input: { uriSrc }
 * Output: { fileSrc, uriSrc }
 *
 * Provides optional caching if the execution context provides a cache.
 * @param dataSource
 * @returns
 */
const downloadUrl: ImportHandler = async (
  dataSource,
  { execute, done, extra }
) => {
  const { fileSrc, uriSrc } = dataSource;
  if (!fileSrc && uriSrc && canFetchUrl(uriSrc.uri)) {
    try {
      let file = await fetchFile(uriSrc.uri, uriSrc.name, {
        cache: extra?.fetchFileCache,
      });
      if (uriSrc.encrypted) {
        await AesTool.init();
        const aesTool = new AesTool();
        let res = aesTool.decryptFile(
          new Uint8Array(await file.arrayBuffer())
        );
        if (res === 'decryp file error') {
          // error
          res = getFile;
        }
        file = new File([res], uriSrc.name);
      }
      execute({
        ...dataSource,
        fileSrc: {
          file,
          fileType: '',
        },
      });
      return done();
    } catch (err) {
      throw new Error(`Could not download URL ${uriSrc.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return dataSource;
};

export default downloadUrl;
