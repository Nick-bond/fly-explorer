import { mat4Multiply, mat4Perspective, mat4RotateX, mat4RotateY, mat4Translate } from '../render/math';
import type { Mat4, Vec3 } from '../render/math';
import type { Room } from '../env/Room';
import type { Input } from './Input';

// First-person SPECTATOR camera for the human observer: walking-pace
// movement clamped inside the room. Not part of the environment — the
// brain never sees this view.
export class Camera {
  pos: Vec3;
  yaw: number;
  pitch: number;
  speed = 2.0;            // m/s
  lookSensitivity = 0.005;
  fov = Math.PI / 3;

  constructor({ pos = [2.2, 1.6, 2.4] as Vec3, yaw = 0.74, pitch = -0.1 } = {}) {
    this.pos = pos;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  update(dt: number, input: Input, room: Room): void {
    const look = input.consumeLook();
    this.yaw -= look.dx * this.lookSensitivity;
    this.pitch -= look.dy * this.lookSensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    const axis = input.moveAxis();
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // forward on floor plane
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);  // strafe right
    let dx = axis.forward * fx + axis.strafe * rx;
    let dz = axis.forward * fz + axis.strafe * rz;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx = (dx / len) * this.speed * dt;
      dz = (dz / len) * this.speed * dt;
    }
    this.pos[0] += dx;
    this.pos[1] += axis.vertical * this.speed * dt;
    this.pos[2] += dz;
    room.clampPoint(this.pos, 0.25);
    this.pos[1] = Math.max(0.3, this.pos[1]); // keep the eye off the floor
  }

  viewProj(aspect: number): Mat4 {
    const proj = mat4Perspective(this.fov, aspect, 0.05, 50);
    let view = mat4Multiply(mat4RotateX(-this.pitch), mat4RotateY(-this.yaw));
    view = mat4Multiply(view, mat4Translate(-this.pos[0], -this.pos[1], -this.pos[2]));
    return mat4Multiply(proj, view);
  }
}
