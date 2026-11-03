export function setResolution(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  width: number,
  height: number,
) {
  const location = gl.getUniformLocation(program, "u_resolution");
  if (location) {
    gl.uniform2f(location, width, height);
  }
}
