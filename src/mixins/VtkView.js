export default {
  props: {
    active: Boolean,
    viewType: String,
    viewName: String,
    // TODO these 3 props should be determined by viewType
    axis: {
      type: Number,
      default: 0,
      validator(v) {
        return v === 0 || v === 1 || v === 2;
      },
    },
    orientation: {
      type: Number,
      default: 1,
      validator(v) {
        return v === -1 || v === 1;
      },
    },
    viewUp: {
      type: Array,
      default: () => [0, 0, 1],
      validator(v) {
        return v.length === 3;
      },
    },
  },

  watch: {
    viewType() {
      this.remountView();
    },
    viewName() {
      this.remountView();
    },
    axis() {
      this.updateCamera();
    },
    orientation() {
      this.updateCamera();
    },
    viewUp() {
      this.updateCamera();
    },
  },

  mounted() {
    this.$eventBus.$on('resize', this.resizeLater);
    this.view = null;
    this.remountView();
  },

  beforeDestroy() {
    this.$eventBus.$off('resize', this.resizeLater);
    this.view = null;
    this.remountView();
  },

  methods: {
    beforeViewUnmount() {},
    afterViewMount() {},

    remountView() {
      if (this.view) {
        this.beforeViewUnmount();
        this.view.setContainer(null);
      }

      this.view = this
        .$proxyManager
        .getViews()
        .find((v) => v.getProxyName() === this.viewType
          && v.getName() === this.viewName);
      if (!this.view) {
        this.view = this.$proxyManager.createProxy('Views', this.viewType, {
          name: this.viewName,
        });
      }

      if (this.view) {
        const container = this.$refs.vtkContainer;
        this.view.setContainer(container);
        this.view.getRenderer().setBackground(0, 0, 0);
        this.updateCamera();

        // let vue rendering settle before resizing canvas
        this.$nextTick(() => {
          this.onResize();
          this.resetCamera();
          this.view.renderLater();
          this.afterViewMount();
        });
      }
    },

    updateCamera() {
      if (this.view) {
        this.view.updateOrientation(this.axis, this.orientation, this.viewUp);
      }
    },

    resizeLater() {
      this.$nextTick(() => this.onResize());
    },

    onResize() {
      if (this.view) {
        // re-implemented from ViewProxy, since we don't
        // want camera reset from view.renderLater()
        const container = this.view.getContainer();
        const glrw = this.view.getOpenglRenderWindow();
        const dims = container.getBoundingClientRect();
        if (dims.width > 0 && dims.height > 0) {
          const pixelRatio = window.devicePixelRatio ?? 1;
          const width = Math.max(10, Math.floor(pixelRatio * dims.width));
          const height = Math.max(10, Math.floor(pixelRatio * dims.height));
          glrw.setSize(width, height);
          this.view.invokeResize({ width, height });
          this.view.getRenderWindow().render();
        }
      }
    },

    resetCamera() {
      if (this.view) {
        this.view.resetCamera();
      }
    },
  },
};
