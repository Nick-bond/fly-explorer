import { Room } from './Room';
import { Fly } from './Fly';
import { FlyEyes } from './vision';
import type { EyeOptions } from './vision';
import type { Renderer, SceneNode } from '../render/Renderer';
import type { Action, Observation } from './types';

export interface EnvironmentOptions {
  eyes?: EyeOptions;
  visualScale?: number;
}

// The complete simulation: room + fly + sensing, behind a step/reset API
// shaped like an RL environment. The brain (over the WebSocket link)
// drives it with Actions and receives Observations; the spectator UI only
// reads `sceneNodes` to draw the third-person view.
export class Environment {
  readonly room: Room;
  readonly fly: Fly;
  readonly eyes: FlyEyes;

  private seq = 0;
  private simTime = 0;
  private episode = 1;

  constructor(renderer: Renderer, options: EnvironmentOptions = {}) {
    this.room = new Room(renderer);
    this.fly = new Fly(renderer, { visualScale: options.visualScale ?? 25 });
    this.eyes = new FlyEyes(renderer, options.eyes);
  }

  // Respawn the fly (center of the room, zero velocity, random yaw) and
  // clear counters. Returns the first observation of the new episode.
  reset(): Observation {
    this.fly.reset();
    this.seq = 0;
    this.simTime = 0;
    this.episode += 1;
    return this.observe(0);
  }

  // Advance the simulation by dt under `action`, then sense.
  step(action: Action, dt: number): Observation {
    this.fly.step(action, dt, this.room);
    this.simTime += dt;
    this.seq += 1;
    return this.observe(dt);
  }

  // Render both eyes from the fly's current pose (the fly never sees its
  // own body) and pack the observation.
  private observe(dt: number): Observation {
    this.eyes.render(this.fly, this.room.nodes);
    return {
      seq: this.seq,
      episode: this.episode,
      dt,
      simTime: this.simTime,
      eyeResolution: this.eyes.resolution,
      leftEye: this.eyes.leftPixels,
      rightEye: this.eyes.rightPixels,
      telemetry: this.fly.telemetry(),
    };
  }

  // Everything the spectator view draws: the room plus the fly's body.
  get sceneNodes(): SceneNode[] {
    return [...this.room.nodes, ...this.fly.nodes];
  }
}
