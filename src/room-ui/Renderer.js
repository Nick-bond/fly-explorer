import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders.js';
import { FLOATS_PER_VERT } from './geometry.js';

// Owns the WebGL context, shader program and draw internals.
// Everything else in the app talks to the GPU only through this class:
//   createMesh(geometry)               -> mesh handle
//   createRenderTarget(size)           -> offscreen square target (fly eyes)
//   render(camera, nodes, opts)        -> draws one frame to screen or target
//   readTarget(target, out)            -> RGBA pixels of a target
// A "node" is { mesh, model, rotation, grid? } — see Room and Actor.
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;

    const program = gl.createProgram();
    gl.attachShader(program, this._compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, this._compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    this.program = program;

    this.loc = {
      aPosition: gl.getAttribLocation(program, 'aPosition'),
      aNormal: gl.getAttribLocation(program, 'aNormal'),
      aColor: gl.getAttribLocation(program, 'aColor'),
      uModel: gl.getUniformLocation(program, 'uModel'),
      uRotation: gl.getUniformLocation(program, 'uRotation'),
      uViewProj: gl.getUniformLocation(program, 'uViewProj'),
      uLightPos: gl.getUniformLocation(program, 'uLightPos'),
      uGrid: gl.getUniformLocation(program, 'uGrid'),
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0.06, 0.075, 0.09, 1);

    // Fixed lighting: one static light just under the ceiling center.
    gl.uniform3f(this.loc.uLightPos, 0, 2.85, 0);
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  createMesh(geometry) {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    return { buf, count: geometry.length / FLOATS_PER_VERT };
  }

  // Square offscreen color+depth target, e.g. one fly eye.
  createRenderTarget(size) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, size };
  }

  readTarget(target, out) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, target.size, target.size, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  get aspect() {
    return this.canvas.width / this.canvas.height;
  }

  _resizeCanvas() {
    const canvas = this.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // camera must provide viewProj(aspect). opts:
  //   target:   render target from createRenderTarget (default: the screen)
  //   showGrid: draw the floor grid (default true; eye renders pass false)
  render(camera, nodes, { target = null, showGrid = true } = {}) {
    const gl = this.gl;
    const loc = this.loc;

    let aspect;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.size, target.size);
      aspect = 1;
    } else {
      this._resizeCanvas();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      aspect = this.aspect;
    }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc.uViewProj, false, camera.viewProj(aspect));

    const stride = FLOATS_PER_VERT * 4;
    for (const node of nodes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, node.mesh.buf);
      gl.enableVertexAttribArray(loc.aPosition);
      gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(loc.aNormal);
      gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(loc.aColor);
      gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, stride, 24);
      gl.uniformMatrix4fv(loc.uModel, false, node.model);
      gl.uniformMatrix4fv(loc.uRotation, false, node.rotation);
      gl.uniform1f(loc.uGrid, node.grid && showGrid ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, node.mesh.count);
    }

    if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
