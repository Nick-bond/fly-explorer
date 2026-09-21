// Controllers are the fly's brain seam. The neural network plugs in here:
// implement update(dt, fly, ctx) and return the four commands.
//
//   { thrust, lift, yaw, pitch }   — each in [-1, 1]
//
// thrust = forward thrust, lift = vertical thrust,
// yaw / pitch = torque commands.
//
// The brain's only sensory input is the fly's two eyes:
//   fly.eyes.leftPixels / fly.eyes.rightPixels — RGBA Uint8Arrays,
//   resolution × resolution, rendered fresh each frame before update()
//   is called. It must never read the spectator camera, and reading
//   privileged world state (fly.pos, room geometry, …) is for debugging
//   only, not for the real brain.
//
// No controller is implemented yet on purpose: with no controller the fly
// receives all-zero commands and stays where it is. All movement logic
// belongs to the future neural network, not to the simulation.

export class FlyController {
  // eslint-disable-next-line no-unused-vars
  update(dt, fly, ctx) {
    return { thrust: 0, lift: 0, yaw: 0, pitch: 0 };
  }
}
