import { makeBox, hex, solid } from '../render/geometry';
import { mat4Identity, mat4Translate } from '../render/math';
import type { Renderer, SceneNode } from '../render/Renderer';
import type { Vec3 } from '../render/math';

export interface Bounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

interface Aabb {
  min: Vec3;
  max: Vec3;
}

// The room: a 6 x 6 x 3 m shell plus static obstacle boxes.
// Coordinate system: X = left/right, Y = up/down, Z = forward/back;
// origin = center of the floor (0, 0, 0).
//
// Also the spatial authority — the fly and the spectator camera ask it
// where they are allowed to be via `bounds`, `clampPoint` and `collideSphere`.
export class Room {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly nodes: SceneNode[] = [];
  private readonly colliders: Aabb[] = [];

  constructor(renderer: Renderer, { width = 6, height = 3, depth = 6 } = {}) {
    this.width = width;
    this.height = height;
    this.depth = depth;

    // Room surfaces are neutral grays with different brightness so
    // boundaries stay obvious; the boxes carry the colors.
    const wall = hex(0xc4c4c4);   // light gray
    const shellGeom = makeBox(width, height, depth, {
      px: wall, nx: wall,
      py: hex(0xd4d4d4),          // ceiling: light gray
      ny: hex(0x8f8f8f),          // floor: medium gray
      pz: wall, nz: wall,
    }, true);

    this.nodes.push({
      mesh: renderer.createMesh(shellGeom),
      model: mat4Translate(0, height / 2, 0),
      rotation: mat4Identity(),
      grid: true,
    });

    // Obstacle boxes B1..B7 — asymmetric on purpose so views from
    // different spots produce distinct silhouettes.
    // pos = box CENTER (y = h/2 puts it on the floor), size = [w, h, d].
    const boxSpecs: Array<{ pos: Vec3; size: Vec3; color: number }> = [
      { pos: [-1.8, 0.5,  -1.8], size: [0.8, 1.0, 0.8], color: 0xb0563a }, // B1 rust
      { pos: [ 1.7, 0.75, -1.6], size: [1.0, 1.5, 0.7], color: 0x4a6fa5 }, // B2 slate blue
      { pos: [-1.4, 0.35,  1.5], size: [1.4, 0.7, 0.6], color: 0xc9a227 }, // B3 ochre
      { pos: [ 1.6, 0.6,   1.6], size: [0.7, 1.2, 1.1], color: 0x77855f }, // B4 sage
      { pos: [ 0.2, 0.4,  -2.1], size: [0.6, 0.8, 0.6], color: 0x9a6b8f }, // B5 plum
      { pos: [-2.1, 0.9,   0.2], size: [0.5, 1.8, 0.9], color: 0x3f7d74 }, // B6 teal
      { pos: [ 2.0, 0.25,  0.1], size: [1.1, 0.5, 1.3], color: 0x8a4f68 }, // B7 mulberry
    ];

    for (const b of boxSpecs) {
      this.nodes.push({
        mesh: renderer.createMesh(makeBox(b.size[0], b.size[1], b.size[2], solid(b.color))),
        model: mat4Translate(b.pos[0], b.pos[1], b.pos[2]),
        rotation: mat4Identity(),
        grid: false,
      });
      this.colliders.push({
        min: [b.pos[0] - b.size[0] / 2, b.pos[1] - b.size[1] / 2, b.pos[2] - b.size[2] / 2],
        max: [b.pos[0] + b.size[0] / 2, b.pos[1] + b.size[1] / 2, b.pos[2] + b.size[2] / 2],
      });
    }
  }

  get bounds(): Bounds {
    return {
      minX: -this.width / 2, maxX: this.width / 2,
      minY: 0,               maxY: this.height,
      minZ: -this.depth / 2, maxZ: this.depth / 2,
    };
  }

  // True when the point is inside one of the obstacle boxes (used by the
  // observer/mapper to exclude unreachable space from coverage).
  isPointInObstacle(p: readonly number[]): boolean {
    for (const box of this.colliders) {
      if (
        p[0] >= box.min[0] && p[0] <= box.max[0] &&
        p[1] >= box.min[1] && p[1] <= box.max[1] &&
        p[2] >= box.min[2] && p[2] <= box.max[2]
      ) return true;
    }
    return false;
  }

  // Clamp a point to stay inside the room shell, `margin` meters away
  // from every surface. Mutates and returns the point.
  // (Walls only — use collideSphere to also respect the boxes.)
  clampPoint(p: Vec3 | number[], margin = 0.25): typeof p {
    const b = this.bounds;
    p[0] = Math.max(b.minX + margin, Math.min(b.maxX - margin, p[0]));
    p[1] = Math.max(b.minY + margin, Math.min(b.maxY - margin, p[1]));
    p[2] = Math.max(b.minZ + margin, Math.min(b.maxZ - margin, p[2]));
    return p;
  }

  // Collide a sphere (center p, radius r) against the room shell and every
  // obstacle box. Pushes p out of penetration (mutates it) and returns an
  // array of contact normals (unit vectors pointing away from the surface).
  collideSphere(p: Vec3 | number[], r: number): Vec3[] {
    const hits: Vec3[] = [];
    const b = this.bounds;

    if (p[0] < b.minX + r) { p[0] = b.minX + r; hits.push([1, 0, 0]); }
    if (p[0] > b.maxX - r) { p[0] = b.maxX - r; hits.push([-1, 0, 0]); }
    if (p[1] < b.minY + r) { p[1] = b.minY + r; hits.push([0, 1, 0]); }
    if (p[1] > b.maxY - r) { p[1] = b.maxY - r; hits.push([0, -1, 0]); }
    if (p[2] < b.minZ + r) { p[2] = b.minZ + r; hits.push([0, 0, 1]); }
    if (p[2] > b.maxZ - r) { p[2] = b.maxZ - r; hits.push([0, 0, -1]); }

    for (const box of this.colliders) {
      const cx = Math.max(box.min[0], Math.min(box.max[0], p[0]));
      const cy = Math.max(box.min[1], Math.min(box.max[1], p[1]));
      const cz = Math.max(box.min[2], Math.min(box.max[2], p[2]));
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;

      if (d2 > 1e-12) {
        // Center outside the box: push out along the closest-point direction.
        const d = Math.sqrt(d2);
        const n: Vec3 = [dx / d, dy / d, dz / d];
        p[0] += n[0] * (r - d);
        p[1] += n[1] * (r - d);
        p[2] += n[2] * (r - d);
        hits.push(n);
      } else {
        // Center inside the box: push out along the axis of least penetration.
        const pens: Array<[number, Vec3]> = [
          [p[0] - box.min[0], [-1, 0, 0]], [box.max[0] - p[0], [1, 0, 0]],
          [p[1] - box.min[1], [0, -1, 0]], [box.max[1] - p[1], [0, 1, 0]],
          [p[2] - box.min[2], [0, 0, -1]], [box.max[2] - p[2], [0, 0, 1]],
        ];
        let best = pens[0];
        for (const pen of pens) if (pen[0] < best[0]) best = pen;
        const [depth, n] = best;
        p[0] += n[0] * (depth + r);
        p[1] += n[1] * (depth + r);
        p[2] += n[2] * (depth + r);
        hits.push(n);
      }
    }
    return hits;
  }
}
