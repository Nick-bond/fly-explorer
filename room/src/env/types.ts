// Shared environment types — see /PROTOCOL.md for the wire format.

// The motor commands the brain outputs. The fly can accelerate along all
// three body axes (thrust may be negative = backward), turn, and brake to
// a stop — direction changes and stop/start are combinations of these.
export interface Action {
  thrust: number; // body-forward thrust, [-1, 1] (negative flies backward)
  strafe: number; // body-right thrust, [-1, 1] (sideways)
  lift: number;   // vertical thrust, [-1, 1]
  yaw: number;    // yaw torque, [-1, 1]
  pitch: number;  // pitch torque, [-1, 1]
  brake: number;  // extra velocity damping, [0, 1]
}

export const ZERO_ACTION: Readonly<Action> =
  { thrust: 0, strafe: 0, lift: 0, yaw: 0, pitch: 0, brake: 0 };

const clamp = (v: unknown, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;

export function sanitizeAction(a: Partial<Action> | undefined): Action {
  return {
    thrust: clamp(a?.thrust, -1, 1),
    strafe: clamp(a?.strafe, -1, 1),
    lift: clamp(a?.lift, -1, 1),
    yaw: clamp(a?.yaw, -1, 1),
    pitch: clamp(a?.pitch, -1, 1),
    brake: clamp(a?.brake, 0, 1),
  };
}

// Privileged simulation state: for reward computation and debugging,
// never a sensory channel for the brain.
export interface FlyTelemetry {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  velocity: [number, number, number];
  yawRate: number;
  pitchRate: number;
  softContacts: number;
  minorContacts: number;
  alive: boolean;
  deathCause: string | null;
}

// One frame's output of the environment. The eye buffers are the brain's
// only sensory input (RGBA, bottom row first, resolution × resolution).
export interface Observation {
  seq: number;
  episode: number;
  dt: number;
  simTime: number;
  eyeResolution: number;
  leftEye: Uint8Array;
  rightEye: Uint8Array;
  telemetry: FlyTelemetry;
}
