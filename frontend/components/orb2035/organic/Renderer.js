import * as THREE from "three";

import Experience from "./Experience";

export default class Renderer {
  constructor({ canvas, size } = {}) {
    this.experience = Experience.instance;
    this.canvas = canvas;
    this.size = size;

    this.instance = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });

    this.instance.setClearColor(0x000000, 0);
    this.setSize();
  }

  setSize(width, height) {
    const nextWidth = width ?? this.experience?.width ?? this.size ?? 0;
    const nextHeight = height ?? this.experience?.height ?? this.size ?? 0;

    this.instance.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.instance.setSize(nextWidth, nextHeight, false);
  }

  update() {
    const scene = this.experience?.scene;
    const camera = this.experience?.camera?.instance;

    if (scene && camera) {
      this.instance.render(scene, camera);
    }
  }

  destroy() {
    this.instance?.dispose?.();
  }
}
