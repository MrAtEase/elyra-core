import * as THREE from "three";

export default class Camera {
  constructor(experience) {
    this.experience = experience;

    const aspect = this.experience.width / Math.max(this.experience.height, 1);

    this.instance = new THREE.PerspectiveCamera(25, aspect, 0.1, 15);
    this.instance.rotation.reorder("YXZ");
    this.instance.position.set(0, 0, 4.5);

    this.experience.scene.add(this.instance);
  }

  resize(width, height) {
    const nextWidth = width ?? this.experience.width;
    const nextHeight = height ?? this.experience.height;
    this.instance.aspect = nextWidth / Math.max(nextHeight, 1);
    this.instance.updateProjectionMatrix();
  }

  update() {}

  destroy() {}
}
