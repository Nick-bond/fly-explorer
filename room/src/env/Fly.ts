import { makeBox, solid } from '../render/geometry';
import { mat4Multiply, mat4RotateX, mat4RotateY, mat4Translate } from '../render/math';
import type { Mat4, Vec3 } from '../render/math';
import type { Renderer, SceneNode } from '../render/Renderer';
import type { Room } from './Room';
import type { Action, FlyTelemetry } from './types';

// "Curious Explorer" — the fly.
//
// Physical body (true scale, meters):
export const BODY = { length: 0.003, width: 0.002, height: 0.002 };
export const COLLISION_RADIUS = 0.0015;

const DEG = Math.PI / 180;

// Physics tuning. Drag values are "per tick" at 60 Hz, applied
// frame-rate-independently as drag^(dt*60).
const THRUST_ACCEL = 1.5;   // m/s² at full forward/backward thrust
const STRAFE_ACCEL = 1.0;   // m/s² at full sideways thrust
const LIFT_ACCEL = 1.0;     // m/s² at full vertical thrust
const TURN_STRENGTH = 12.0; // rad/s² at full yaw/pitch torque
const LINEAR_DRAG = 0.98;
const ANGULAR_DRAG = 0.95;
const BRAKE_DRAG = 0.88;    // additional per-tick damping at full brake

// Movement limits — experimental values, not biology, sized so the
// sensorimotor loop can keep up: at 0.5 m/s the fly travels ~2-5 cm per
// ~50-100 ms neural reaction, instead of outrunning its own perception.
// (Indoor Drosophila cruise is ~0.2-0.7 m/s.) Keep them consistent
// across runs so the network trains against a fixed world.
const MAX_FORWARD_SPEED = 0.5;    // m/s, horizontal
const MAX_VERTICAL_SPEED = 0.3;   // m/s
const MAX_YAW_RATE = 500 * DEG;   // rad/s
const MAX_PITCH_RATE = 500 * DEG; // rad/s
const MAX_PITCH = 80 * DEG;       // rad

// Collision severity by impact speed (velocity into the surface, m/s),
// scaled to the speed envelope: gentle contact is survivable, a
// full-speed impact (0.35+ of the 0.5 max) is lethal — so braking
// before a surface is what keeps the fly alive.
const SOFT_IMPACT = 0.1;
const MINOR_IMPACT = 0.35;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const START_POS: Vec3 = [0, 1.5, 0];

interface FlyPart {
  node: SceneNode;
  local: Mat4;
  localRot: Mat4;
}

// The fly's physical body and minimal flight physics. It carries NO
// behavior: it only integrates the Action the environment hands it.
export class Fly {
  readonly visualScale: number; // render-only magnification; physics stays true-scale

  pos: Vec3 = [...START_POS];
  vel: Vec3 = [0, 0, 0];
  yaw = 0;
  pitch = 0;
  yawRate = 0;
  pitchRate = 0;
  alive = true;
  softContacts = 0;
  minorContacts = 0;
  deathCause: string | null = null;

  readonly nodes: SceneNode[] = [];
  private readonly parts: FlyPart[] = [];

  constructor(renderer: Renderer, { visualScale = 25 } = {}) {
    this.visualScale = visualScale;
    this.buildBody(renderer);
    this.reset();
  }

  reset(): void {
    this.pos = [...START_POS];
    this.vel = [0, 0, 0];
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.alive = true;
    this.softContacts = 0;
    this.minorContacts = 0;
    this.deathCause = null;
    this.updateNodes();
  }

  // Unit forward vector from yaw/pitch (yaw 0 faces -Z).
  forward(): Vec3 {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  telemetry(): FlyTelemetry {
    return {
      position: [...this.pos],
      yaw: this.yaw,
      pitch: this.pitch,
      velocity: [...this.vel],
      yawRate: this.yawRate,
      pitchRate: this.pitchRate,
      softContacts: this.softContacts,
      minorContacts: this.minorContacts,
      alive: this.alive,
      deathCause: this.deathCause,
    };
  }

  // Integrate one physics step under `action`. No decisions are made here.
  step(action: Action, dt: number, room: Room): void {
    if (!this.alive) return;

    // Rotation: torque -> rate -> angle, with angular damping and caps.
    const angularDrag = Math.pow(ANGULAR_DRAG, dt * 60);
    this.yawRate = clamp((this.yawRate + action.yaw * TURN_STRENGTH * dt) * angularDrag, -MAX_YAW_RATE, MAX_YAW_RATE);
    this.pitchRate = clamp((this.pitchRate + action.pitch * TURN_STRENGTH * dt) * angularDrag, -MAX_PITCH_RATE, MAX_PITCH_RATE);
    this.yaw += this.yawRate * dt;
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -MAX_PITCH, MAX_PITCH);

    // Translation: thrust along forward (signed — negative flies backward),
    // strafe along body-right, vertical lift; then drag, plus extra brake
    // damping so the fly can stop and restart mid-flight.
    const fwd = this.forward();
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    this.vel[0] += (fwd[0] * action.thrust * THRUST_ACCEL + right[0] * action.strafe * STRAFE_ACCEL) * dt;
    this.vel[1] += fwd[1] * action.thrust * THRUST_ACCEL * dt + action.lift * LIFT_ACCEL * dt;
    this.vel[2] += (fwd[2] * action.thrust * THRUST_ACCEL + right[2] * action.strafe * STRAFE_ACCEL) * dt;
    const brakeDrag = Math.pow(BRAKE_DRAG, dt * 60 * action.brake);
    const linearDrag = Math.pow(LINEAR_DRAG, dt * 60) * brakeDrag;
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
    const hits = room.collideSphere(this.pos, COLLISION_RADIUS);
    for (const n of hits) {
      const vn = this.vel[0] * n[0] + this.vel[1] * n[1] + this.vel[2] * n[2];
      const impact = vn < 0 ? -vn : 0;
      if (impact > MINOR_IMPACT) {
        this.alive = false;
        this.deathCause = 'collision';
        this.vel = [0, 0, 0];
        break;
      }
      if (impact > SOFT_IMPACT) this.minorContacts += 1;
      else this.softContacts += 1;
      // Slide: cancel the velocity component going into the surface.
      if (vn < 0) {
        this.vel[0] -= n[0] * vn;
        this.vel[1] -= n[1] * vn;
        this.vel[2] -= n[2] * vn;
      }
    }

    this.updateNodes();
  }

  // Stylized fly built from primitives, sized in mm of body space
  // (forward = -Z, so the head sits at negative Z). Rendering only —
  // physics uses the plain BODY / COLLISION_RADIUS values.
  private buildBody(renderer: Renderer): void {
    const mm = 0.001 * this.visualScale;
    const addPart = (size: Vec3, pos: Vec3, color: number, yawLocal = 0): void => {
      const localRot = mat4RotateY(yawLocal);
      const local = mat4Multiply(
        mat4Translate(pos[0] * mm, pos[1] * mm, pos[2] * mm),
        localRot,
      );
      const mesh = renderer.createMesh(
        makeBox(size[0] * mm, size[1] * mm, size[2] * mm, solid(color)),
      );
      const node: SceneNode = { mesh, model: mat4Translate(...this.pos), rotation: localRot, grid: false };
      this.parts.push({ node, local, localRot });
      this.nodes.push(node);
    };

    addPart([0.7, 0.7, 0.6],   [0, 0.05, -1.2],     0x3b3630); // head
    addPart([0.3, 0.3, 0.3],   [-0.24, 0.18, -1.4], 0x8a2b23); // left eye
    addPart([0.3, 0.3, 0.3],   [0.24, 0.18, -1.4],  0x8a2b23); // right eye
    addPart([1.0, 0.9, 1.0],   [0, 0.1, -0.35],     0x4a4036); // thorax
    addPart([0.9, 0.75, 1.6],  [0, 0, 0.7],         0x2f2b26); // abdomen
    addPart([0.85, 0.06, 1.7], [-0.6, 0.55, 0.55],  0xc6ccd2, 0.45);  // left wing
    addPart([0.85, 0.06, 1.7], [0.6, 0.55, 0.55],   0xc6ccd2, -0.45); // right wing
  }

  private updateNodes(): void {
    const rot = mat4Multiply(mat4RotateY(this.yaw), mat4RotateX(this.pitch));
    const base = mat4Multiply(mat4Translate(...this.pos), rot);
    for (const p of this.parts) {
      p.node.model = mat4Multiply(base, p.local);
      p.node.rotation = mat4Multiply(rot, p.localRot);
    }
  }
}
