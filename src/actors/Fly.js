import { Actor } from './Actor.js';
import { FlyEyes } from './vision.js';
import { makeBox, solid } from '../room-ui/geometry.js';
import { mat4Multiply, mat4RotateX, mat4RotateY, mat4Translate } from '../room-ui/math.js';

// "Curious Explorer" — the fly.
//
// Physical body (true scale, meters):
export const BODY = { length: 0.003, width: 0.002, height: 0.002 };
export const COLLISION_RADIUS = 0.0015;

const DEG = Math.PI / 180;

// Physics tuning. Drag values are "per tick" at 60 Hz, applied
// frame-rate-independently as drag^(dt*60).
const THRUST_ACCEL = 4.0;   // m/s² at full forward thrust
const LIFT_ACCEL = 3.0;     // m/s² at full vertical thrust
const TURN_STRENGTH = 12.0; // rad/s² at full yaw/pitch torque
const LINEAR_DRAG = 0.98;
const ANGULAR_DRAG = 0.95;

// Movement limits — experimental values, not biology. Keep them
// consistent across runs so the neural network trains against a fixed world.
const MAX_FORWARD_SPEED = 2.0;        // m/s, horizontal
const MAX_VERTICAL_SPEED = 1.0;       // m/s
const MAX_YAW_RATE = 500 * DEG;       // rad/s
const MAX_PITCH_RATE = 500 * DEG;     // rad/s
const MAX_PITCH = 80 * DEG;           // rad

// Collision severity by impact speed (velocity into the surface, m/s):
// below SOFT it's soft contact, up to MINOR it's a minor collision,
// above that it is lethal.
const SOFT_IMPACT = 0.3;
const MINOR_IMPACT = 1.0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp1 = (v) => clamp(v, -1, 1);

// The neural network (via a FlyController) drives the fly with
//   { thrust, lift, yaw, pitch }  each in [-1, 1].
// Its only sensory input is the two eye buffers (this.eyes).
export class Fly extends Actor {
  constructor({ controller = null, visualScale = 25, eyes = {} } = {}) {
    super();
    this.name = 'curious-explorer';
    this.controller = controller;
    this.visualScale = visualScale; // render-only magnification; physics stays true-scale
    this.eyeOptions = eyes;

    // State
    this.pos = [0, 1.5, 0];
    this.vel = [0, 0, 0];
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.alive = true;
    this.contacts = { soft: 0, minor: 0 };
    this.deathCause = null;
  }

  // Unit forward vector from yaw/pitch (yaw 0 faces -Z).
  forward() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  spawn(renderer, room) {
    this.room = room;
    this.eyes = new FlyEyes(renderer, this.eyeOptions);

    // Stylized fly built from primitives, sized in mm of body space
    // (forward = -Z, so the head sits at negative Z). Rendering only —
    // physics still uses the plain BODY / COLLISION_RADIUS values.
    const mm = 0.001 * this.visualScale;
    this.parts = [];
    const addPart = (size, pos, color, yawLocal = 0) => {
      const localRot = mat4RotateY(yawLocal);
      const local = mat4Multiply(
        mat4Translate(pos[0] * mm, pos[1] * mm, pos[2] * mm),
        localRot,
      );
      const mesh = renderer.createMesh(
        makeBox(size[0] * mm, size[1] * mm, size[2] * mm, solid(color)),
      );
      this.parts.push({
        node: { mesh, model: mat4Translate(...this.pos), rotation: localRot, grid: false },
        local,
        localRot,
      });
    };

    addPart([0.7, 0.7, 0.6],  [0, 0.05, -1.2],      0x3b3630); // head
    addPart([0.3, 0.3, 0.3],  [-0.24, 0.18, -1.4],  0x8a2b23); // left eye
    addPart([0.3, 0.3, 0.3],  [0.24, 0.18, -1.4],   0x8a2b23); // right eye
    addPart([1.0, 0.9, 1.0],  [0, 0.1, -0.35],      0x4a4036); // thorax
    addPart([0.9, 0.75, 1.6], [0, 0, 0.7],          0x2f2b26); // abdomen
    addPart([0.85, 0.06, 1.7],[-0.6, 0.55, 0.55],   0xc6ccd2, 0.45);  // left wing
    addPart([0.85, 0.06, 1.7],[0.6, 0.55, 0.55],    0xc6ccd2, -0.45); // right wing

    this.nodes = this.parts.map((p) => p.node);
    this._updateNodes();
  }

  _updateNodes() {
    const rot = mat4Multiply(mat4RotateY(this.yaw), mat4RotateX(this.pitch));
    const base = mat4Multiply(mat4Translate(...this.pos), rot);
    for (const p of this.parts) {
      p.node.model = mat4Multiply(base, p.local);
      p.node.rotation = mat4Multiply(rot, p.localRot);
    }
  }

  kill(cause = 'unknown') {
    this.alive = false;
    this.deathCause = cause;
  }

  update(dt, ctx) {
    if (!this.alive) return;

    // Sense first: the eyes see the room (never the fly's own body),
    // then the brain decides from those images alone.
    this.eyes.render(this, this.room.nodes);

    const cmdRaw = this.controller ? this.controller.update(dt, this, ctx) : {};
    const cmd = {
      thrust: clamp1(cmdRaw.thrust || 0),
      lift: clamp1(cmdRaw.lift || 0),
      yaw: clamp1(cmdRaw.yaw || 0),
      pitch: clamp1(cmdRaw.pitch || 0),
    };

    // Rotation: torque -> rate -> angle, with angular damping and caps.
    const angularDrag = Math.pow(ANGULAR_DRAG, dt * 60);
    this.yawRate = clamp((this.yawRate + cmd.yaw * TURN_STRENGTH * dt) * angularDrag, -MAX_YAW_RATE, MAX_YAW_RATE);
    this.pitchRate = clamp((this.pitchRate + cmd.pitch * TURN_STRENGTH * dt) * angularDrag, -MAX_PITCH_RATE, MAX_PITCH_RATE);
    this.yaw += this.yawRate * dt;
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -MAX_PITCH, MAX_PITCH);

    // Translation: thrust along forward + vertical lift, with linear drag.
    const fwd = this.forward();
    this.vel[0] += fwd[0] * cmd.thrust * THRUST_ACCEL * dt;
    this.vel[1] += fwd[1] * cmd.thrust * THRUST_ACCEL * dt + cmd.lift * LIFT_ACCEL * dt;
    this.vel[2] += fwd[2] * cmd.thrust * THRUST_ACCEL * dt;
    const linearDrag = Math.pow(LINEAR_DRAG, dt * 60);
    this.vel[0] *= linearDrag;
    this.vel[1] *= linearDrag;
    this.vel[2] *= linearDrag;

    // Speed caps: horizontal and vertical limited separately.
    const hSpeed = Math.hypot(this.vel[0], this.vel[2]);
    if (hSpeed > MAX_FORWARD_SPEED) {
      const k = MAX_FORWARD_SPEED / hSpeed;
      this.vel[0] *= k;
      this.vel[2] *= k;
    }
    this.vel[1] = clamp(this.vel[1], -MAX_VERTICAL_SPEED, MAX_VERTICAL_SPEED);

    this.pos[0] += this.vel[0] * dt;
    this.pos[1] += this.vel[1] * dt;
    this.pos[2] += this.vel[2] * dt;

    // Collisions: every solid participates (floor, ceiling, 4 walls,
    // 7 boxes). Severity depends on impact speed into the surface.
    const hits = ctx.room.collideSphere(this.pos, COLLISION_RADIUS);
    for (const n of hits) {
      const vn = this.vel[0] * n[0] + this.vel[1] * n[1] + this.vel[2] * n[2];
      const impact = vn < 0 ? -vn : 0;
      if (impact > MINOR_IMPACT) {
        this.kill('collision');
        this.vel = [0, 0, 0];
        break;
      }
      if (impact > SOFT_IMPACT) this.contacts.minor += 1;
      else this.contacts.soft += 1;
      // Slide: cancel the velocity component going into the surface.
      if (vn < 0) {
        this.vel[0] -= n[0] * vn;
        this.vel[1] -= n[1] * vn;
        this.vel[2] -= n[2] * vn;
      }
    }

    this._updateNodes();
  }
}
