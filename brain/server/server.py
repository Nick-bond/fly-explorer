"""WebSocket server: the brain's connection to the environment.

Protocol v2 (see /PROTOCOL.md): binary observations in, JSON motor
messages out. The brain runs on its own 100 Hz clock inside
FlyBrain.step; episodes reset it (SPEC §16), death stops it (SPEC §39).

Run:  python3 -m brain.server.server
"""

from __future__ import annotations

import asyncio
import json
import struct
import time

import numpy as np
import websockets

from brain.runtime.brain import FlyBrain, FlySensoryInput
from brain.runtime.motor_decoder import ZERO_OUTPUT

HOST = "localhost"
PORT = 8765
DIAGNOSTICS_EVERY_S = 5.0
DEATH_RESET_DELAY_S = 1.5  # pause on a dead fly before starting the next episode

HEADER = struct.Struct("<BBHIIff3fff3f3fIIB3x")
PROTOCOL_VERSION = 2
MSG_OBSERVATION = 1

# Loaded once; per-connection FlyBrain instances share the dataset via
# module-level caching of this single brain (one environment at a time).
_brain: FlyBrain | None = None


def get_brain() -> FlyBrain:
    global _brain
    if _brain is None:
        print("initializing FlyBrain (loading brain_data/) ...")
        t0 = time.perf_counter()
        _brain = FlyBrain()
        _brain.initialize()
        d = _brain.get_diagnostics()
        print(f"ready in {time.perf_counter() - t0:.1f}s: "
              f"{d['neuronCount']:,} neurons, {d['connectionCount']:,} connections")
    return _brain


def decode(payload: bytes) -> dict:
    (
        version, msg_type, eye_res, seq, episode, dt, sim_time,
        px, py, pz, yaw, pitch, vx, vy, vz,
        yaw_rate, pitch_rate, roll_rate,
        soft, minor, alive,
    ) = HEADER.unpack_from(payload)
    if version != PROTOCOL_VERSION:
        raise ValueError(f"unsupported protocol version {version}")
    if msg_type != MSG_OBSERVATION:
        raise ValueError(f"unexpected message type {msg_type}")

    eye_bytes = eye_res * eye_res * 4

    def eye(at: int) -> np.ndarray:
        img = np.frombuffer(payload, dtype=np.uint8, count=eye_bytes, offset=at)
        return img.reshape(eye_res, eye_res, 4)[::-1]  # row 0 = top

    return {
        "episode": episode, "seq": seq, "dt": dt, "sim_time": sim_time,
        "alive": bool(alive),
        "sensory": FlySensoryInput(
            left_eye=eye(HEADER.size),
            right_eye=eye(HEADER.size + eye_bytes),
            angular_velocity={"yaw": yaw_rate, "pitch": pitch_rate, "roll": roll_rate},
        ),
        # Privileged telemetry — logging/reward only, never fed to the brain.
        "telemetry": {
            "position": (px, py, pz), "yaw": yaw, "pitch": pitch,
            "velocity": (vx, vy, vz), "soft": soft, "minor": minor,
        },
    }


async def handle(ws) -> None:
    print(f"environment connected: {ws.remote_address}")
    brain = get_brain()
    brain.reset()
    episode: int | None = None
    died_at: float | None = None
    last_diag = time.monotonic()

    try:
        async for message in ws:
            if not isinstance(message, (bytes, bytearray)):
                continue
            obs = decode(bytes(message))

            if obs["episode"] != episode:
                episode = obs["episode"]
                died_at = None
                brain.reset()
                print(f"episode {episode} started", flush=True)

            if obs["alive"]:
                motor = brain.step(obs["sensory"], obs["dt"])
            else:
                # Dead fly: brain stops advancing (SPEC §39); after a short
                # pause ask the environment for the next episode.
                motor = dict(ZERO_OUTPUT)
                now = time.monotonic()
                if died_at is None:
                    died_at = now
                    t = obs["telemetry"]
                    print(f"episode {episode} ended: died at "
                          f"({t['position'][0]:+.2f}, {t['position'][1]:+.2f}, {t['position'][2]:+.2f}) "
                          f"after {obs['sim_time']:.1f}s, contacts soft={t['soft']} minor={t['minor']}",
                          flush=True)
                elif now - died_at >= DEATH_RESET_DELAY_S:
                    died_at = now  # avoid re-sending every frame
                    await ws.send(json.dumps({"type": "reset"}))

            await ws.send(json.dumps({
                "type": "motor",
                "episode": episode,
                "simulationTime": obs["sim_time"],
                **motor,
            }))

            now = time.monotonic()
            if now - last_diag >= DIAGNOSTICS_EVERY_S:
                last_diag = now
                d = brain.get_diagnostics()
                print(f"[diag] step {d['simulationStep']:,}  "
                      f"active {d['activeNeuronCount']:,}/{d['neuronCount']:,}  "
                      f"mean {d['meanActivity']:+.4f}  "
                      f"range [{d['minActivity']:+.3f}, {d['maxActivity']:+.3f}]  "
                      f"motor {({k: round(v, 3) for k, v in motor.items()})}", flush=True)
    finally:
        print("environment disconnected")


async def main() -> None:
    get_brain()  # load before accepting connections
    async with websockets.serve(handle, HOST, PORT, max_size=None):
        print(f"brain listening on ws://{HOST}:{PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
