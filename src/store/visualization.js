import vtkMapper from 'vtk.js/Sources/Rendering/Core/Mapper';
import vtkImageMapper from 'vtk.js/Sources/Rendering/Core/ImageMapper';
import vtkBoundingBox from 'vtk.js/Sources/Common/DataModel/BoundingBox';

import {
  addRepresentationsOf, resize2DCameraToFit, removeAllRepresentations,
} from '../vtk/proxyUtils';
import { DataTypes, NO_SELECTION } from '../constants';

const defaultWorldOrientation = () => ({
  // this is real-world bounds, minus rotation
  bounds: [0, 1, 0, 1, 0, 1],
  spacing: [1, 1, 1],
  // identity
  worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});

const defaultWindowing = () => ({
  level: 127,
  width: 255,
  min: 0,
  max: 255,
});

const defaultSlicing = () => ({
  x: 0,
  y: 0,
  z: 0,
});

function createVizPipelineFor(data, proxyManager) {
  let transformType = null;
  if (data.isA('vtkImageData')) {
    transformType = 'ImageTransform';
  } else if (data.isA('vtkPolyData')) {
    transformType = 'PolyDataTransform';
  } else {
    throw new Error('createVizPipelineFor: data is not image or geometry');
  }

  const dataSource = proxyManager.createProxy(
    'Sources',
    'TrivialProducer',
  );
  dataSource.setInputData(data);

  const transformFilter = proxyManager.createProxy(
    'Sources',
    transformType,
    {
      inputProxy: dataSource,
    },
  );

  const pipeline = {
    dataSource,
    transformFilter,
  };

  if (data.isA('vtkPolyData')) {
    const cutterFilter = proxyManager.createProxy(
      'Sources',
      'PolyDataCutter',
      {
        inputProxy: dataSource,
      },
    );
    pipeline.transformFilter.setInputProxy(cutterFilter);
    pipeline.cutterFilter = cutterFilter;
  }

  return pipeline;
}

export default (dependencies) => ({
  namespaced: false,

  state: {
    worldOrientation: defaultWorldOrientation(),
    // data ID -> pipeline
    pipelines: {},
    slices: defaultSlicing(),
    window: defaultWindowing(),
    resizeToFit: true,
  },

  mutations: {
    setVizPipeline(state, { dataID, pipeline }) {
      state.pipelines = {
        ...state.pipelines,
        [dataID]: { ...pipeline },
      };
    },

    setWorldOrientation(state, { bounds, spacing, worldToIndex }) {
      state.worldOrientation = {
        bounds: [...bounds],
        spacing: [...spacing],
        worldToIndex: [...worldToIndex],
      };
    },

    setSlices(state, { x, y, z }) {
      const { slices: s } = state;
      state.slices = {
        x: x ?? s.x,
        y: y ?? s.y,
        z: z ?? s.z,
      };
    },

    setWindowing(state, {
      level, width, min, max,
    }) {
      const { window: w } = state;
      w.level = level ?? w.level;
      w.width = width ?? w.width;
      w.min = min ?? w.min;
      w.max = max ?? w.max;
    },

    setResizeToFit(state, yn) {
      state.resizeToFit = yn;
    },
  },

  actions: {
    async updateSceneLayers({
      dispatch, commit, state, rootState, rootGetters,
    }) {
      const { proxyManager } = dependencies;
      // polys and lines in the front
      vtkMapper.setResolveCoincidentTopologyToPolygonOffset();
      vtkMapper.setResolveCoincidentTopologyPolygonOffsetParameters(-1, -1);
      vtkMapper.setResolveCoincidentTopologyLineOffsetParameters(-1, -1);
      // image poly in the back
      vtkImageMapper.setResolveCoincidentTopologyToPolygonOffset();
      vtkImageMapper.setResolveCoincidentTopologyPolygonOffsetParameters(1, 1);

      // TODO avoid removing widget reps
      removeAllRepresentations(proxyManager);

      const layers = rootGetters.layerOrder;

      await Promise.all(
        layers.map(async (dataID) => {
          const dataInfo = rootState.data.index[dataID];
          if (!(dataID in rootState.data.vtkCache)) {
            switch (dataInfo.type) {
              case DataTypes.Dicom: {
                const { seriesKey } = dataInfo;
                const image = await dispatch('dicom/buildSeriesVolume', seriesKey);
                commit('cacheDicomImage', { seriesKey, image });
                break;
              }
              default:
                throw new Error(
                  `updateSceneLayers: Item ${dataID} has no vtk data`,
                );
            }
          }

          if (!(dataID in state.pipelines)) {
            const vtkObj = rootState.data.vtkCache[dataID];
            const pipeline = createVizPipelineFor(vtkObj, proxyManager);
            commit('setVizPipeline', { dataID, pipeline });
          }
        }),
      );

      // Setting world orientation after processing layers ensures
      // we have a vtk image for our base image
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const image = rootState.data.vtkCache[rootState.selectedBaseImage];
        // vtkImageData scalars define our data. Hope we don't ever
        // have to deal with vector images here...
        const dataArray = image.getPointData().getScalars();
        const [dataMin, dataMax] = dataArray.getRange();

        const spacing = image.getSpacing();
        commit('setWorldOrientation', {
          bounds: image.getExtent().map((e, i) => e * spacing[i % 2]),
          spacing,
          worldToIndex: [...image.getWorldToIndex()],
        });
        commit('setWindowing', {
          min: dataMin,
          max: dataMax,
          width: dataMax - dataMin,
          level: (dataMax + dataMin) / 2,
        });
      } else {
        // set dimensions to be the max bounds of all layers
        const bbox = vtkBoundingBox.newInstance();
        for (let i = 0; i < layers.length; i += 1) {
          const obj = rootState.data.vtkCache[layers[i]];
          bbox.addBox(obj);
        }
        bbox.inflate(5); // some extra padding
        // Without a base image, we assume a spacing of 1.
        commit('setWorldOrientation', {
          ...defaultWorldOrientation(),
          bounds: bbox.getBounds(),
        });
        commit('setWindowing', defaultWindowing());
      }

      // now add layer representations
      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers[i];
        const { transformFilter } = state.pipelines[layer];
        transformFilter.setTransform(state.worldOrientation.worldToIndex);

        addRepresentationsOf(transformFilter, proxyManager);
      }
    },

    async resetViews({ state, rootState, dispatch }) {
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const { bounds } = state.worldOrientation;
        await dispatch('setSlices', {
          x: bounds[0],
          y: bounds[1],
          z: bounds[2],
        });
      } else {
        // pick middle of bounds
        const { bounds } = state.worldOrientation;
        const center = [
          (bounds[0] + bounds[1]) / 2,
          (bounds[2] + bounds[3]) / 2,
          (bounds[4] + bounds[5]) / 2,
        ];
        await dispatch('setSlices', {
          x: center[0],
          y: center[1],
          z: center[2],
        });
      }

      const { proxyManager } = dependencies;

      proxyManager
        .getViews()
        .forEach((view) => {
          if (view.isA('vtkView2DProxy')) {
            const { bounds } = state.worldOrientation;
            const renderer = view.getRenderer();
            renderer.computeVisiblePropBounds();
            renderer.resetCamera(bounds);
          } else {
            // 3D views
            view.resetCamera();
          }
        });

      await dispatch('setResizeToFit', true);
    },

    setSlices({ commit, state, rootGetters }, slices) {
      commit('setSlices', slices);

      // set first slice of each 2D view
      // proxy manager will propagate slice to all other slices in view
      const layers = rootGetters.layerOrder;
      if (layers.length) {
        const firstData = layers[0];
        const { transformFilter } = state.pipelines[firstData];
        if (transformFilter) {
          const { proxyManager } = dependencies;
          proxyManager
            .getViews()
            .filter((view) => view.isA('vtkView2DProxy'))
            .forEach((view) => {
              const rep = proxyManager.getRepresentation(transformFilter, view);
              if (rep.getSlicingMode && rep.setSlice) {
                const mode = rep.getSlicingMode();
                const sliceName = 'xyz'[vtkImageMapper.SlicingMode[mode] % 3];
                rep.setSlice(state.slices[sliceName]);
              }
            });
        }
      }
    },

    async setResizeToFit({ commit, dispatch }, yn) {
      commit('setResizeToFit', yn);
      if (yn) {
        await dispatch('resizeAllCamerasToFit');
      }
    },

    setWindowing({ state, commit, rootState }, params) {
      commit('setWindowing', params);

      // only set windowing on base image
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const { transformFilter } = state.pipelines[rootState.selectedBaseImage];
        if (transformFilter) {
          const { proxyManager } = dependencies;
          const view2D = proxyManager.getViews().find((v) => v.isA('vtkView2DProxy'));
          if (view2D) {
            const rep = proxyManager.getRepresentation(transformFilter, view2D);
            if (rep.setWindowWidth) {
              rep.setWindowWidth(state.window.width);
            }
            if (rep.setWindowLevel) {
              rep.setWindowLevel(state.window.level);
            }
          }
        }
      }
    },

    resizeAllCamerasToFit({ state }) {
      const { proxyManager } = dependencies;
      proxyManager
        .getViews()
        .filter((view) => view.isA('vtkView2DProxy'))
        .forEach((view) => {
          const { bounds } = state.worldOrientation;
          resize2DCameraToFit(view, bounds);
        });
    },

    // ===================
    // ProxyManager events
    // ===================

    pxmProxyModified: {
      root: true,
      handler({ commit }, proxy) {
        if (proxy.getWindowLevel && proxy.getWindowWidth) {
          // ProxyManager will handle syncing windowing params to
          // other proxies, so only record the current value here.
          const level = proxy.getWindowLevel();
          const width = proxy.getWindowWidth();
          commit('setWindowing', { level, width });
        }
      },
    },
  },
});
