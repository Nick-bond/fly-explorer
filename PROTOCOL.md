# Brain ⇄ Environment WebSocket protocol (v2)

The brain (Python, `brain/`) hosts a WebSocket server on `ws://localhost:8765`.
The environment (browser app, `room/`) connects to it as a client — a browser
page cannot host a server.

Flow: the environment streams one **observation** per rendered frame
(binary); the brain replies with **motor** messages (JSON). The loop is
asynchronous, not lockstep — the environment always applies the most
recently received command and never blocks on the brain; the brain runs its
own fixed 10 ms clock internally (an accumulator turns each observation's dt
into 0..N neural steps). If no brain is connected the fly receives zero
commands and hovers.

## Observation (environment → brain, binary frame)

Little-endian. Header is 76 bytes, then the two eye images.
Python header format string: `"<BBHIIff3fff3f3fIIB3x"`.

| offset | type    | field                                   |
|-------:|---------|-----------------------------------------|
| 0      | u8      | protocol version (2)                    |
| 1      | u8      | message type (1 = observation)          |
| 2      | u16     | eye resolution `R` (pixels per side)    |
| 4      | u32     | frame sequence number                   |
| 8      | u32     | episode number (bumps on every reset)   |
| 12     | f32     | dt — seconds simulated by this frame    |
| 16     | f32     | sim time — seconds since reset          |
| 20     | 3 × f32 | fly position x, y, z (m) — privileged   |
| 32     | f32     | yaw (rad) — privileged                  |
| 36     | f32     | pitch (rad) — privileged                |
| 40     | 3 × f32 | velocity x, y, z (m/s) — privileged     |
| 52     | f32     | yaw rate (rad/s) — sensory              |
| 56     | f32     | pitch rate (rad/s) — sensory            |
| 60     | f32     | roll rate (rad/s, 0 for now) — sensory  |
| 64     | u32     | soft contact count — privileged         |
| 68     | u32     | minor collision count — privileged      |
| 72     | u8      | alive (1/0)                             |
| 73     | 3 × u8  | padding                                 |
| 76     | R·R·4 u8| left eye RGBA, bottom row first         |
| 76+R²·4| R·R·4 u8| right eye RGBA, bottom row first        |

**Sensory vs privileged** (SPEC §17): the brain may sense only the eye
images and the angular rates. Position, orientation, linear velocity and
contact counts are privileged telemetry for logging/reward/mapping — the
brain server must never feed them into the neural network.

## Motor (brain → environment, JSON text frame)

```json
{
  "type": "motor",
  "episode": 12,
  "simulationTime": 18.43,
  "forward": -0.41,
  "yaw": -0.18,
  "pitch": 0.03,
  "vertical": 0.06,
  "lateral": 0.12,
  "brake": 0.0,
  "escape": 0.0
}
```

Ranges: `forward` (negative = backward), `yaw`, `pitch`, `vertical` and
`lateral` (sideways) in [-1, 1]; `brake` (velocity damping — stop
mid-flight) and `escape` in [0, 1]. Together these span acceleration
along all three body axes plus turning and stopping. Missing fields read
as 0; the environment clamps. The command stays in effect until the next
one arrives. The environment maps this onto its body physics (escape
currently adds a forward thrust burst). The legacy v1 form
`{"type": "action", thrust, lift, yaw, pitch}` is still accepted.

## Reset (brain → environment, JSON text frame)

```json
{ "type": "reset" }
```

Respawns the fly at (0, 1.5, 0), zero velocity, random yaw, alive, with
counters and sim time cleared, and increments the episode number. The
brain resets its neural state whenever the episode number changes
(SPEC §16); when `alive` is 0 the brain stops advancing (SPEC §39).
