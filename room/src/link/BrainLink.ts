import { ZERO_ACTION, sanitizeAction } from '../env/types';
import type { Action, Observation } from '../env/types';

// WebSocket client to the Python brain (see /PROTOCOL.md).
//
// The environment streams binary observations; the brain replies with
// JSON actions. Asynchronous, never lockstep: `latestAction` always holds
// the most recent command (zeros when disconnected) and the sim never
// blocks on the brain.

export type LinkStatus = 'disconnected' | 'connecting' | 'connected';

const PROTOCOL_VERSION = 2;
const MSG_OBSERVATION = 1;
const HEADER_BYTES = 76;
const RECONNECT_DELAY_MS = 2000;
// Skip frames rather than queue them if the socket falls behind.
const MAX_BUFFERED_BYTES = 256 * 1024;

export class BrainLink {
  latestAction: Action = { ...ZERO_ACTION };
  status: LinkStatus = 'disconnected';
  onStatusChange: ((status: LinkStatus) => void) | null = null;

  private readonly url: string;
  private ws: WebSocket | null = null;
  private resetRequested = false;
  private encodeBuffer: ArrayBuffer | null = null;

  constructor(url = 'ws://localhost:8765') {
    this.url = url;
    this.connect();
  }

  // True once per requested reset; the caller performs env.reset().
  consumeResetRequest(): boolean {
    const requested = this.resetRequested;
    this.resetRequested = false;
    return requested;
  }

  sendObservation(obs: Observation): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) return;

    const eyeBytes = obs.leftEye.byteLength;
    const total = HEADER_BYTES + eyeBytes * 2;
    if (!this.encodeBuffer || this.encodeBuffer.byteLength !== total) {
      this.encodeBuffer = new ArrayBuffer(total);
    }
    const view = new DataView(this.encodeBuffer);
    const t = obs.telemetry;
    view.setUint8(0, PROTOCOL_VERSION);
    view.setUint8(1, MSG_OBSERVATION);
    view.setUint16(2, obs.eyeResolution, true);
    view.setUint32(4, obs.seq, true);
    view.setUint32(8, obs.episode, true);
    view.setFloat32(12, obs.dt, true);
    view.setFloat32(16, obs.simTime, true);
    view.setFloat32(20, t.position[0], true);
    view.setFloat32(24, t.position[1], true);
    view.setFloat32(28, t.position[2], true);
    view.setFloat32(32, t.yaw, true);
    view.setFloat32(36, t.pitch, true);
    view.setFloat32(40, t.velocity[0], true);
    view.setFloat32(44, t.velocity[1], true);
    view.setFloat32(48, t.velocity[2], true);
    view.setFloat32(52, t.yawRate, true);
    view.setFloat32(56, t.pitchRate, true);
    view.setFloat32(60, 0, true); // roll rate: body has no roll axis yet
    view.setUint32(64, t.softContacts, true);
    view.setUint32(68, t.minorContacts, true);
    view.setUint8(72, t.alive ? 1 : 0);
    const bytes = new Uint8Array(this.encodeBuffer);
    bytes.set(obs.leftEye, HEADER_BYTES);
    bytes.set(obs.rightEye, HEADER_BYTES + eyeBytes);
    ws.send(this.encodeBuffer);
  }

  private setStatus(status: LinkStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }

  private connect(): void {
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => this.setStatus('connected');
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data) as {
          type?: string;
          forward?: number;
          lateral?: number;
          vertical?: number;
          escape?: number;
        } & Partial<Action>;
        if (msg.type === 'motor') {
          // FlyMotorOutput -> body physics Action. Forward is signed
          // (negative = backward). Escape is a retreat burst — backward
          // and upward, away from whatever fills the forward view —
          // mirroring the Giant Fiber jump away from a looming stimulus.
          const escape = Math.max(0, (msg.escape ?? 0));
          this.latestAction = sanitizeAction({
            thrust: (msg.forward ?? 0) - escape,
            strafe: msg.lateral,
            lift: (msg.vertical ?? 0) + 0.5 * escape,
            yaw: msg.yaw,
            pitch: msg.pitch,
            brake: msg.brake,
          });
        } else if (msg.type === 'action') {
          this.latestAction = sanitizeAction(msg); // legacy v1 form
        } else if (msg.type === 'reset') {
          this.resetRequested = true;
        }
      } catch {
        // Malformed frame: ignore.
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.latestAction = { ...ZERO_ACTION }; // dead link must not keep steering
      this.setStatus('disconnected');
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    };
    ws.onerror = () => ws.close();
  }
}
