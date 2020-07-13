import WidgetManagerConstants from 'vtk.js/Sources/Widgets/Core/WidgetManager/Constants';

const { ViewTypes } = WidgetManagerConstants;

function withWidgetManager(view, handler) {
  const wm = view.getReferenceByName('widgetManager');
  if (wm) {
    handler(wm);
  }
}

export function is2DView(view) {
  return view.getClassName() === 'vtkView2DProxy';
}

export const FOLLOW_VIEW = 'FOLLOW_VIEW';
export const ALWAYS_VISIBLE = 'ALWAYS_VISIBLE';
export const NEVER_VISIBLE = 'NEVER_VISIBLE';

/**
 * mouse view behaviors:
 * - FOLLOW_VIEW: only be visible in whichever view has the mouse
 * - ALWAYS_VISIBLE: always visible
 * - NEVER_VISIBLE: never visible
 *
 * the view behavior only applies if the widget chooses to render into the matching view type
 */
export default class Widget {
  constructor(id, store) {
    this.id = id;
    this.store = store;
    this.watchers = [];
    this.widgetInstances = new Map();
    this.currentView = null;

    // configurable
    this.mouse2DViewBehavior = ALWAYS_VISIBLE;
    this.mouse3DViewBehavior = ALWAYS_VISIBLE;
    this.removeOnDeactivate = true;
    this.lockToCurrentViewFlag = false; // only applicable to FOLLOW_VIEW
  }

  watchStore(...args) {
    this.watchers.push(this.store.watch(...args));
  }

  addToView(view, type = ViewTypes.DEFAULT, initialValues = {}) {
    withWidgetManager(view, (wm) => {
      const widget = wm.addWidget(this.factory, type, initialValues);
      this.widgetInstances.set(view, widget);
    });
  }

  removeFromView(view) {
    if (this.currentView === view) {
      this.currentView = null;
    }
    withWidgetManager(view, (wm) => {
      this.widgetInstances.delete(view);
      wm.removeWidget(this.factory);
    });
  }

  focus(view) {
    withWidgetManager(view, (wm) => {
      if (this.widgetInstances.has(view)) {
        wm.grabFocus(this.widgetInstances.get(view));
      }
    });
  }

  static unfocus(view) {
    withWidgetManager(view, (wm) => wm.releaseFocus());
  }

  deactivateSelf() {
    this.store.dispatch('deactivateWidget', this.id);
  }

  removeSelf() {
    this.store.dispatch('removeWidget', this.id);
  }

  delete() {
    while (this.watchers.length) {
      this.watchers.pop()();
    }
    [...this.widgetInstances.keys()].forEach((view) =>
      this.removeFromView(view)
    );
  }

  lockPickingToCurrentView(yn) {
    this.lockToCurrentViewFlag = yn;
    this.updatePicking(this.currentView);
  }

  setCurrentView(view) {
    if (!this.lockToCurrentViewFlag) {
      this.currentView = view;
    }
    this.updateManipulator(this.currentView);
    this.updateVisibility(this.currentView);
  }

  updatePicking(currentView) {
    const it = this.widgetInstances.entries();
    let { value, done } = it.next();
    while (!done) {
      const [view, viewWidget] = value;
      if (is2DView(view)) {
        let pickable = true;
        if (
          this.mouse2DViewBehavior === FOLLOW_VIEW &&
          this.lockToCurrentViewFlag
        ) {
          pickable = view === currentView;
        }
        viewWidget.setPickable(pickable);
      }
      // TODO 3D view

      ({ value, done } = it.next());
    }
  }

  updateVisibility(currentView) {
    const it = this.widgetInstances.entries();
    let { value, done } = it.next();
    while (!done) {
      const [view, viewWidget] = value;
      if (is2DView(view)) {
        let visible = false;
        if (this.mouse2DViewBehavior === FOLLOW_VIEW) {
          visible = view === currentView;
        } else if (this.mouse2DViewBehavior === ALWAYS_VISIBLE) {
          visible = true;
        }
        viewWidget.setVisibility(visible);
        viewWidget.setContextVisibility(visible);
      }
      // TODO 3D view

      // render
      view.getReferenceByName('widgetManager').renderWidgets();
      view.getRenderWindow().render();

      ({ value, done } = it.next());
    }
  }

  // eslint-disable-next-line class-methods-use-this
  updateManipulator() {}
}
