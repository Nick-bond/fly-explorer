# Fly Explorer

A raw-WebGL (no libraries, no build step) simulation room for a fly —
"curious explorer" — that will eventually be driven by a neural system.

## World

- Room: 6 × 6 × 3 m, solid walls/floor/ceiling, no doors.
- Coordinates: X = left/right, Y = up/down, Z = forward/back;
  origin = center of the floor (0, 0, 0).
- 7 obstacle boxes (B1–B7 in `src/room-ui/Room.js`), placed asymmetrically
  to create narrow passages, open regions and distinct silhouettes.

- Lighting: fixed ambient + one static ceiling light. No shadows,
  reflections, animated lights or textures. Room surfaces are neutral
  grays (walls/ceiling light, floor medium); the 7 boxes each have a
  distinct color, so B1–B7 are individually identifiable by sight.

## The fly

- Body 3 × 2 × 2 mm, collision radius ~1.5 mm (true scale in physics;
  rendered magnified via `visualScale`, default 25×, set 1 for true scale).
- Starts at (0, 1.5, 0), velocity 0, random yaw.
- State: position, yaw/pitch, linear velocity, yaw/pitch rates, alive/dead,
  soft/minor contact counts.
- Minimal physics (in `src/actors/Fly.js`): thrust along forward + vertical
  lift, torque -> angular rate -> angle, linear drag 0.98 / angular drag
  0.95 per 60 Hz tick (applied frame-rate independently).
- Movement limits (experimental values, kept consistent across runs):
  max forward speed 2 m/s, max vertical speed 1 m/s, max yaw rate 500°/s,
  max pitch ±80°.
- Collisions: every solid participates (floor, ceiling, 4 walls, 7 boxes),
  sphere vs. shell + AABBs via `Room.collideSphere`. Severity by impact
  speed into the surface: < 0.3 m/s soft contact, < 1.0 m/s minor
  collision, above that lethal (`alive = false`).

## Vision

Two virtual eyes (`src/actors/vision.js`), not compound eyes yet: simple
wide-FOV cameras at the head. ~1 mm separation, 160° FOV, 64 × 64 RGBA
per eye (use `new Fly({ eyes: { resolution: 32 } })` for 32 × 32).
Rendered offscreen every frame before the controller runs; the floor's
1 m grid is spectator-only and excluded from eye renders, and the fly's
own body is never in its view. The brain receives ONLY
`fly.eyes.leftPixels` / `fly.eyes.rightPixels` — never the spectator
camera. The HUD shows both eye buffers bottom-left, for humans.

## The brain seam

The neural network plugs in as a controller (`src/actors/controllers.js`):

```js
class MyBrain extends FlyController {
  update(dt, fly, ctx) {
    return { thrust, lift, yaw, pitch }; // each in [-1, 1]
  }
}
new Fly({ controller: new MyBrain() });
```

There is deliberately no controller yet: without one the fly receives
all-zero commands and hovers at its start position. All movement logic
belongs to the future neural network, not to the simulation.

## Run

ES modules need an HTTP server (opening `index.html` via `file://` won't work):

```sh
npm run dev        # serves on http://localhost:5173
```

## Structure

```
index.html              Entry page: canvas + HUD, loads src/main.js
src/
  main.js               App: wires renderer/room/camera/input, runs the loop,
                        owns the actor registry (app.addActor)
  room-ui/              Everything WebGL / room-related
    Renderer.js         GL context, shader program, createMesh(), render()
    Room.js             Room shell + boxes B1–B7; spatial authority
                        (bounds, clampPoint, collideSphere)
    Camera.js           First-person spectator camera (walk + look)
    Input.js            Keyboard + pointer drag, decoupled from consumers
    geometry.js         Box geometry builder, color helpers
    shaders.js          Vertex/fragment shader sources
    math.js             Minimal column-major mat4 helpers
  actors/
    Actor.js            Base class: spawn(renderer, room) + update(dt, ctx)
    Fly.js              The fly: body, minimal flight physics, movement
                        caps, collision severity, eyes
    vision.js           FlyEyes: two offscreen eye cameras + pixel readback
    controllers.js      FlyController interface (the neural network's seam)
```
