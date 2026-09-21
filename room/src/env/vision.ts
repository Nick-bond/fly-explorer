import { mat4Multiply, mat4Perspective, mat4RotateX, mat4RotateY, mat4Translate } from '../render/math';
import type { Renderer, RenderTarget, SceneNode } from '../render/Renderer';
import type { Fly } from './Fly';

export interface EyeOptions {
  resolution?: number;  // pixels per eye (try 32 for faster experiments)
  fovDeg?: number;      // per-eye field of view
  separation?: number;  // meters between the eyes (~1 mm)
}

// The fly's two virtual eyes: simple wide-FOV cameras at the head, not
// compound eyes. Each renders the room to a low-res offscreen target and
// the RGBA pixels are read back for the brain. The brain must never see
// the spectator camera — these two buffers are its only visual input.
export class FlyEyes {
  readonly resolution: number;
  readonly fov: number;
  readonly separation: number;
  readonly leftPixels: Uint8Array;   // RGBA, bottom row first (WebGL readPixels order)
  readonly rightPixels: Uint8Array;

  private readonly renderer: Renderer;
  private readonly targets: { left: RenderTarget; right: RenderTarget };

  constructor(renderer: Renderer, { resolution = 64, fovDeg = 160, separation = 0.001 }: EyeOptions = {}) {
    this.renderer = renderer;
    this.resolution = resolution;
    this.fov = (fovDeg * Math.PI) / 180;
    this.separation = separation;
    this.targets = {
      left: renderer.createRenderTarget(resolution),
      right: renderer.createRenderTarget(resolution),
    };
    this.leftPixels = new Uint8Array(resolution * resolution * 4);
    this.rightPixels = new Uint8Array(resolution * resolution * 4);
  }

  // Render both eyes from the fly's current pose. `nodes` is what the fly
  // can see (the room; never the fly's own body).
  render(fly: Fly, nodes: readonly SceneNode[]): void {
    const fwd = fly.forward();
    const right = [Math.cos(fly.yaw), 0, -Math.sin(fly.yaw)];
    // Eyes sit at the front of the body.
    const headOffset = 0.0015;
    const head = [
      fly.pos[0] + fwd[0] * headOffset,
      fly.pos[1] + fwd[1] * headOffset,
      fly.pos[2] + fwd[2] * headOffset,
    ];
    this.renderEye(head, right, -this.separation / 2, fly, nodes, this.targets.left, this.leftPixels);
    this.renderEye(head, right, +this.separation / 2, fly, nodes, this.targets.right, this.rightPixels);
  }

  private renderEye(
    head: number[],
    right: number[],
    offset: number,
    fly: Fly,
    nodes: readonly SceneNode[],
    target: RenderTarget,
    out: Uint8Array,
  ): void {
    const eyePos = [
      head[0] + right[0] * offset,
      head[1] + right[1] * offset,
      head[2] + right[2] * offset,
    ];
    // Near plane below the collision radius so surfaces never clip inside it.
    const proj = mat4Perspective(this.fov, 1, 0.0008, 20);
    let view = mat4Multiply(mat4RotateX(-fly.pitch), mat4RotateY(-fly.yaw));
    view = mat4Multiply(view, mat4Translate(-eyePos[0], -eyePos[1], -eyePos[2]));
    const viewProj = mat4Multiply(proj, view);

    this.renderer.render({ viewProj: () => viewProj }, nodes, { target, showGrid: false });
    this.renderer.readTarget(target, out);
  }
}
