# Fly Explorer

A simulation of a fly — "curious explorer"

```
room/    the ENVIRONMENT — TypeScript + Vite + raw WebGL
brain/   the BRAIN — Python; the FlyWire neural simulation lives here
data/    FlyWire connectome data (loaded by brain/load_connectome.py)
```

## Architecture

```
┌──────────────────────────┐
│ WebGL application (room/)│
│ room + fly + eye cameras │
└────────────┬─────────────┘
             │  sensory frame (binary observation)
             ▼
        WebSocket  ws://localhost:8765
             │
             ▼
┌──────────────────────────┐
│ Python brain server      │
│  FlyWire graph           │   load_connectome.py
│  neuron state            │   brain.py
│  neural simulation       │   brain.py
│  sensory encoder         │   sensory.py  (SensoryEncoder)
│  motor decoder           │   motor.py   (MotorDecoder)
└────────────┬─────────────┘
             │  {thrust, lift, yaw, pitch}
             ▼
┌──────────────────────────┐
│ WebGL fly actor          │
└──────────────────────────┘
```

The brain hosts a WebSocket server (`ws://localhost:8765`); the room app
connects to it, streams binary observations (both eye images + telemetry)
every frame, and applies the latest action the brain has sent. The loop is
asynchronous — the environment never blocks on the brain, and with no brain
connected the fly receives zero commands and hovers.

## Run

```sh
pip install -r brain/requirements.txt

npm run preprocess         # once (and after changing data/ or preprocess config):
                           # raw Codex .gz -> brain_data/ + validation report
npm run validate           # optional: offline dynamics + sensory causality check

# terminal 1 — the brain
npm run brain              # = python3 -m brain.server.server

# terminal 2 — the room
cd room && npm install     # first time only
npm run dev                # http://localhost:5173
```

Episodes run continuously: the connectome drives the fly, death triggers a
brain-requested reset after a short pause, and a new episode begins.
The HUD shows the brain link status; the two bottom-left previews show
exactly what each eye sends to the brain.

## The world

- Room: 6 × 6 × 3 m, solid walls/floor/ceiling, no doors.
- Coordinates: X = left/right, Y = up/down, Z = forward/back;
  origin = center of the floor (0, 0, 0).
- 7 obstacle boxes (B1–B7 in `room/src/env/Room.ts`), asymmetric, each a
  distinct color; room surfaces are neutral grays.
- Lighting: fixed ambient + one static ceiling light. No shadows,
  reflections, animated lights or textures.

## The fly

- Body 3 × 2 × 2 mm, collision radius ~1.5 mm (true scale in physics;
  rendered magnified via `visualScale`, default 25×).
- Starts at (0, 1.5, 0), zero velocity, random yaw.
- Minimal physics (`room/src/env/Fly.ts`): signed thrust along forward
  (negative = backward), sideways strafe, vertical lift, torque -> angular
  rate -> angle, linear drag 0.98 / angular drag 0.95 per 60 Hz tick
  (frame-rate independent), plus a brake command that damps velocity —
  the fly can accelerate on all three axes, reverse, stop and restart.
- Limits (experimental, keep consistent across runs): max forward 2 m/s,
  vertical 1 m/s, yaw rate 500°/s, pitch ±80°.
- Collisions: all 13 solids; by impact speed — < 0.3 m/s soft contact,
  < 1.0 m/s minor collision, above lethal.
- Vision: two eyes (~1 mm apart, 160° FOV, 64 × 64 RGBA each), rendered
  offscreen; the fly never sees its own body, and the brain never sees the
  spectator camera.
- The fly carries NO behavior. All movement comes from the brain's actions.

## Architecture (room app)

```
room/src/
  render/        pure WebGL: Renderer, shaders, box geometry, mat4 math
  env/           the environment (simulation) — no UI, no network
    types.ts     Action / Observation / telemetry types
    Room.ts      shell + boxes B1–B7, bounds + sphere collision
    Fly.ts       body, flight physics, movement caps, collision severity
    vision.ts    FlyEyes: two offscreen eye cameras + pixel readback
    Environment.ts  step(action, dt) / reset() facade over room + fly
  link/          BrainLink: WebSocket client, binary obs out / JSON actions in
  ui/            spectator-only: first-person Camera + Input
  main.ts        wires it all, runs the frame loop, eye previews + HUD
```

The environment is deliberately shaped like an RL environment
(`reset()` / `step(action, dt) -> observation`) so the brain side can wrap
it in a training loop.

## Brain (python)

Implements SPEC.md v0.1 (§41 layout):

```
brain/
  config/brain.json        all modeling assumptions: transmitter signs, dt,
                           decay, gains, vision grid — config, not code
  preprocess/              raw Codex .gz -> brain_data/ (SPEC §29)
    load_connections.py    filtered graph (syn_count >= 5 -> ~3.4M edges)
    load_neurons.py        annotations joined per neuron
    load_transmitters.py   configured transmitter signs per edge
    build_brain.py         pipeline + stage-1 validation report
  runtime/
    dynamics.py            sparse CSR rate model: tanh(decay*a + s*(W@a) + ext)
    sensory_encoder.py     eyes -> 16x16 luminance + temporal diff -> photoreceptors
    motor_decoder.py       descending populations -> forward/yaw/pitch/vertical/escape
    diagnostics.py         SPEC §25 diagnostics
    brain.py               FlyBrain: initialize/reset/step (own 100 Hz clock)
  server/server.py         protocol v2 WebSocket server + episode loop
  validate_dynamics.py     stages 2-3: stability, left/right causality, determinism
brain_data/                preprocessed dataset (generated, ~40 MB)
```

Populations (selected from FlyWire annotations, stored in brain_data/):
photoreceptors by side as visual input (4,955 L / 4,751 R); descending
neurons by side as the motor boundary (647 L / 650 R); DNp01 (Giant
Fiber) as escape. Vertical/pitch populations are empty in v0.1 and decode
to 0.

## Observer / mapper

`room/src/observer/` watches the fly from outside using privileged true
coordinates — strictly one-way, nothing ever flows back to the brain:

- `Mapper.ts` — 0.25 m voxel grid over the room (space inside boxes is
  excluded from the denominator), cumulative + per-episode coverage, and
  a death log (episode, position, sim time, contacts).
- `MapLayer.ts` — draws the 3D exploration map in the spectator view:
  discovered voxels as translucent cubes colored by height, deaths as
  red markers. Toggle with **M**. Never rendered into the eyes.

The HUD shows `episode · deaths · explored %`; full records are at
`window.flyexplorer.mapper` in the browser console.
