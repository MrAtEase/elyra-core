import { createOrbRoot } from "./createOrbRoot";
import { initGL } from "./gl/initGL";
import { startLoop } from "./loop";

class OrbSystem {
  private initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const canvas = createOrbRoot();
    const gl = initGL(canvas);

    startLoop(gl);
  }
}

export const ORB = new OrbSystem();
