import { join } from '@src/utils/path';

// const base = import.meta.env.ITK_BASE_URL;
const base = './';
// console.log('base:', base);

const fullUrl = (relative) =>
  new URL(join(base, relative), document.location.origin + document.location.pathname).href;
// console.log('fullUrl:', fullUrl('/itk/pipeline.worker.js'));
const itkConfig = {
  pipelineWorkerUrl: fullUrl('/itk/pipeline.worker.js'),
  imageIOUrl: fullUrl('/itk/image-io'),
  meshIOUrl: fullUrl('/itk/mesh-io'),
  pipelinesUrl: fullUrl('/itk/pipelines'),
};

export default itkConfig;
