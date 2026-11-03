import Sphere from "./Sphere";

export default class World {
  constructor(experience) {
    this.experience = experience;
    this.scene = this.experience.scene;

    this.setSphere();
  }

  setSphere() {
    this.sphere = new Sphere(this.experience);
  }

  resize() {}

  update() {
    if (this.sphere) {
      this.sphere.update();
    }
  }

  destroy() {
    this.sphere?.destroy?.();
  }
}
