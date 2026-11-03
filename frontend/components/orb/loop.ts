type GLWithProgram = WebGLRenderingContext & { program?: WebGLProgram };

export function startLoop(gl: WebGLRenderingContext) {
  let t = 0;

  function frame() {
    t += 0.016;
    const program = (gl as GLWithProgram).program;
    if (program) {
      gl.uniform1f(gl.getUniformLocation(program, "u_time"), t);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    requestAnimationFrame(frame);
  }

  frame();
}
