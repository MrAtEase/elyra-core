import * as THREE from "three";

import Renderer from "./Renderer";
import Camera from "./Camera";
import World from "./World";

export default class Experience {
  static instance;

  constructor({ targetElement, size } = {}) {
    Experience.instance = this;

    this.targetElement = targetElement;
    this.size = size;

    if (!this.targetElement) {
      return;
    }

    this.scene = new THREE.Scene();
    this.time = {
      last: performance.now(),
      delta: 16,
    };

    this.setSize();

    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";

    this.targetElement.appendChild(this.canvas);

    this.renderer = new Renderer({
      canvas: this.canvas,
      size: this.size,
    });

    this.camera = new Camera(this);
    this.world = new World(this);

    // Expose sphere for external state control (e.g. Elli runtime state)
    this.sphere = this.world.sphere ?? null;

    this._tick = this._tick.bind(this);
    this._running = true;
    this._tick();
  }

  setSize() {
    const rect = this.targetElement.getBoundingClientRect();
    const fallback = this.size || rect.width || rect.height || 0;
    const width = rect.width || fallback;
    const height = rect.height || fallback;

    this.width = this.size || width;
    this.height = this.size || height;
  }

  _tick() {
    if (!this._running) return;

    const now = performance.now();
    const delta = now - this.time.last;

    this.time.delta = Math.min(delta, 60);
    this.time.last = now;

    if (this.camera && this.camera.update) {
      this.camera.update();
    }

    if (this.world && this.world.update) {
      this.world.update();
    }

    if (this.renderer && this.renderer.update) {
      this.renderer.update();
    }

    this._raf = window.requestAnimationFrame(this._tick);
  }

  destroy() {
    this._running = false;
    if (this._raf) {
      window.cancelAnimationFrame(this._raf);
    }

    this.world?.destroy?.();
    this.camera?.destroy?.();
    this.renderer?.destroy?.();

    this.canvas?.remove();

    Experience.instance = null;
  }
}
