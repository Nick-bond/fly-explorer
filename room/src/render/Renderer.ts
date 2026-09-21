import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders';
import { FLOATS_PER_VERT } from './geometry';
import type { Mat4 } from './math';

export interface Mesh {
  buf: WebGLBuffer;
  count: number;
}

// A mesh with preallocated GPU capacity that geometry can be appended to
// (used by the exploration map, which grows as voxels are discovered).
export interface DynamicMesh extends Mesh {
  capacityVerts: number;
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  size: number;
}

// Anything drawable: Room, Fly and the map overlay expose these.
export interface SceneNode {
  mesh: Mesh;
  model: Mat4;
  rotation: Mat4;
  grid?: boolean;
  alpha?: number; // < 1 renders in a translucent pass after opaque nodes
}

export interface CameraLike {
  viewProj(aspect: number): Mat4;
}

export interface RenderOptions {
  target?: RenderTarget;  // default: the screen
  showGrid?: boolean;     // default true; eye renders pass false
}

// Owns the WebGL context, shader program and draw internals.
// Everything else in the app talks to the GPU only through this class.
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly loc: {
    aPosition: number;
    aNormal: number;
    aColor: number;
    uModel: WebGLUniformLocation;
    uRotation: WebGLUniformLocation;
    uViewProj: WebGLUniformLocation;
    uLightPos: WebGLUniformLocation;
    uGrid: WebGLUniformLocation;
    uAlpha: WebGLUniformLocation;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, this.compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    }
    gl.useProgram(program);

    const uniform = (name: string): WebGLUniformLocation => {
      const u = gl.getUniformLocation(program, name);
      if (!u) throw new Error(`uniform ${name} not found`);
      return u;
    };
    this.loc = {
      aPosition: gl.getAttribLocation(program, 'aPosition'),
      aNormal: gl.getAttribLocation(program, 'aNormal'),
      aColor: gl.getAttribLocation(program, 'aColor'),
      uModel: uniform('uModel'),
      uRotation: uniform('uRotation'),
      uViewProj: uniform('uViewProj'),
      uLightPos: uniform('uLightPos'),
      uGrid: uniform('uGrid'),
      uAlpha: uniform('uAlpha'),
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0.06, 0.075, 0.09, 1);

    // Fixed lighting: one static light just under the ceiling center.
    gl.uniform3f(this.loc.uLightPos, 0, 2.85, 0);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
    }
    return sh;
  }

  createMesh(geometry: Float32Array): Mesh {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    return { buf, count: geometry.length / FLOATS_PER_VERT };
  }

  createDynamicMesh(capacityVerts: number): DynamicMesh {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, capacityVerts * FLOATS_PER_VERT * 4, gl.DYNAMIC_DRAW);
    return { buf, count: 0, capacityVerts };
  }

  appendToMesh(mesh: DynamicMesh, geometry: Float32Array): void {
    const verts = geometry.length / FLOATS_PER_VERT;
    if (mesh.count + verts > mesh.capacityVerts) return; // full: silently stop growing
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, mesh.count * FLOATS_PER_VERT * 4, geometry);
    mesh.count += verts;
  }

  // Square offscreen color+depth target, e.g. one fly eye.
  createRenderTarget(size: number): RenderTarget {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, size };
  }

  readTarget(target: RenderTarget, out: Uint8Array): Uint8Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, target.size, target.size, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }

  private resizeCanvas(): void {
    const canvas = this.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  render(camera: CameraLike, nodes: readonly SceneNode[], { target, showGrid = true }: RenderOptions = {}): void {
    const gl = this.gl;
    const loc = this.loc;

    let aspect: number;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.size, target.size);
      aspect = 1;
    } else {
      this.resizeCanvas();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      aspect = this.aspect;
    }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc.uViewProj, false, camera.viewProj(aspect));

    const opaque = nodes.filter((n) => (n.alpha ?? 1) >= 1);
    const translucent = nodes.filter((n) => (n.alpha ?? 1) < 1);

    for (const node of opaque) this.drawNode(node, showGrid);
    if (translucent.length > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const node of translucent) this.drawNode(node, showGrid);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private drawNode(node: SceneNode, showGrid: boolean): void {
    const gl = this.gl;
    const loc = this.loc;
    const stride = FLOATS_PER_VERT * 4;
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
    gl.uniform1f(loc.uAlpha, node.alpha ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, node.mesh.count);
  }
}
