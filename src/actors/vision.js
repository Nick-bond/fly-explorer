import { mat4Multiply, mat4Perspective, mat4RotateX, mat4RotateY, mat4Translate } from '../room-ui/math.js';

// The fly's two virtual eyes: simple wide-FOV cameras at the head, not
// compound eyes. Each renders the room to a low-res offscreen target and
// the RGBA pixels are read back for the brain. The brain must never see
// the spectator camera — these two buffers are its only visual input.
export class FlyEyes {
  constructor(renderer, {
    resolution = 64,      // pixels per eye (try 32 for faster experiments)
    fovDeg = 160,         // per-eye field of view
    separation = 0.001,   // ~1 mm between the eyes
  } = {}) {
    this.renderer = renderer;
    this.resolution = resolution;
    this.fov = (fovDeg * Math.PI) / 180;
    this.separation = separation;

    this.targets = {
      left: renderer.createRenderTarget(resolution),
      right: renderer.createRenderTarget(resolution),
    };
    // RGBA, bottom row first (WebGL readPixels order).
    this.leftPixels = new Uint8Array(resolution * resolution * 4);
    this.rightPixels = new Uint8Array(resolution * resolution * 4);
  }

  // Render both eyes from the fly's current pose. `nodes` is what the fly
  // can see (the room; never the fly's own body).
  render(fly, nodes) {
    const fwd = fly.forward();
    const right = [Math.cos(fly.yaw), 0, -Math.sin(fly.yaw)];
    // Eyes sit at the front of the body.
    const headOffset = 0.0015;
    const head = [
      fly.pos[0] + fwd[0] * headOffset,
      fly.pos[1] + fwd[1] * headOffset,
      fly.pos[2] + fwd[2] * headOffset,
    ];
    this._renderEye(head, right, -this.separation / 2, fly, nodes, this.targets.left, this.leftPixels);
    this._renderEye(head, right, +this.separation / 2, fly, nodes, this.targets.right, this.rightPixels);
  }

  _renderEye(head, right, offset, fly, nodes, target, out) {
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
