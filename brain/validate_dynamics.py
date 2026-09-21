"""Validation stages 2 + 3 (SPEC §32–§33): the brain, disconnected from WebGL.

Stage 2 — dynamics: stimulate a small known population, verify the
network does not saturate everywhere, collapse permanently to zero,
produce NaN, or oscillate without bound.

Stage 3 — sensory causality: LEFT vs RIGHT synthetic visual stimulus
must propagate through the connectome to measurably different
descending-neuron activity.

Run:  python3 -m brain.validate_dynamics
"""

from __future__ import annotations

import numpy as np

from brain.runtime.brain import FlyBrain, FlySensoryInput

EYE_RES = 64
DT = 0.01  # one brain tick per step call


def blank_eye() -> np.ndarray:
    return np.zeros((EYE_RES, EYE_RES, 4), dtype=np.uint8)


def bright_eye() -> np.ndarray:
    return np.full((EYE_RES, EYE_RES, 4), 255, dtype=np.uint8)


def run_episode(brain: FlyBrain, left: np.ndarray, right: np.ndarray, steps: int) -> dict:
    brain.reset()
    trace = []
    for _ in range(steps):
        motor = brain.step(FlySensoryInput(left_eye=left, right_eye=right), DT)
        trace.append(brain.get_diagnostics() | {"motor": motor})
    return trace[-1] | {"trace": trace}


def main() -> None:
    print("loading brain ...")
    brain = FlyBrain()
    brain.initialize()
    n = brain.get_diagnostics()["neuronCount"]
    failures: list[str] = []

    # ---- Stage 2: dynamics under full-field stimulation --------------
    print("\n== Stage 2: dynamics ==")
    end = run_episode(brain, bright_eye(), bright_eye(), 100)
    act = brain.activity
    print(f"after 100 steps: active {end['activeNeuronCount']:,}/{n:,}  "
          f"mean {end['meanActivity']:+.4f}  range [{end['minActivity']:+.3f}, {end['maxActivity']:+.3f}]")
    if not np.isfinite(act).all():
        failures.append("NaN/inf activity")
    if end["activeNeuronCount"] == 0:
        failures.append("network collapsed to zero under stimulation")
    if end["activeNeuronCount"] > 0.95 * n:
        failures.append("network saturated (>95% neurons active)")

    # Stimulus removed: activity must decay, not oscillate unbounded.
    for _ in range(200):
        brain.step(FlySensoryInput(left_eye=blank_eye(), right_eye=blank_eye()), DT)
    after = brain.get_diagnostics()
    print(f"after 200 dark steps: active {after['activeNeuronCount']:,}  "
          f"mean {after['meanActivity']:+.4f}")
    if after["activeNeuronCount"] > end["activeNeuronCount"]:
        failures.append("activity grew after stimulus removal")

    # ---- Stage 3: sensory causality (left vs right) ------------------
    print("\n== Stage 3: sensory causality ==")

    def descending_response(left: np.ndarray, right: np.ndarray) -> tuple[float, float]:
        run_episode(brain, left, right, 60)
        act = brain.activity
        groups = brain.decoder.groups
        return float(np.abs(act[groups["left_turn"]]).mean()), float(np.abs(act[groups["right_turn"]]).mean())

    dl_l, dl_r = descending_response(bright_eye(), blank_eye())   # LEFT stimulus
    dr_l, dr_r = descending_response(blank_eye(), bright_eye())   # RIGHT stimulus
    print(f"LEFT stimulus  -> |descending| left {dl_l:.5f}  right {dl_r:.5f}")
    print(f"RIGHT stimulus -> |descending| left {dr_l:.5f}  right {dr_r:.5f}")
    if dl_l + dl_r == 0 or dr_l + dr_r == 0:
        failures.append("no descending response to visual stimulus")
    if (dl_l, dl_r) == (dr_l, dr_r):
        failures.append("left and right stimuli produced identical descending activity")

    # ---- Stage 3b: looming stimulus (SPEC §33) -----------------------
    print("\n== Stage 3b: looming ==")

    def square_frame(size: int) -> np.ndarray:
        """Dark square of `size` px centered on a light background."""
        frame = np.full((EYE_RES, EYE_RES, 4), 220, dtype=np.uint8)
        if size > 0:
            a = EYE_RES // 2 - size // 2
            frame[a:a + size, a:a + size, :3] = 20
        return frame

    def escape_after(frames: list[np.ndarray]) -> tuple[float, float]:
        brain.reset()
        motor = {"escape": 0.0}
        loom_seen = 0.0
        for frame in frames:
            motor = brain.step(FlySensoryInput(left_eye=frame, right_eye=frame), DT)
            loom_seen = max(loom_seen, brain.encoder.last_looming["left"])
        return motor["escape"], loom_seen

    growing = [square_frame(s) for s in range(2, 58, 4)]        # approaching object
    static = [square_frame(20)] * len(growing)                  # same object, no approach
    esc_grow, loom_grow = escape_after(growing)
    esc_static, loom_static = escape_after(static)
    print(f"growing square: loom {loom_grow:.5f}  escape {esc_grow:.3f}")
    print(f"static square:  loom {loom_static:.5f}  escape {esc_static:.3f}")
    if loom_grow <= loom_static:
        failures.append("looming estimator does not respond to expansion")
    if esc_grow <= esc_static:
        failures.append("escape output does not prefer looming over static stimulus")

    # ---- Determinism (SPEC §36) --------------------------------------
    a = run_episode(brain, bright_eye(), blank_eye(), 30)["motor"]
    b = run_episode(brain, bright_eye(), blank_eye(), 30)["motor"]
    print(f"\ndeterminism: run A {a}\n             run B {b}")
    if a != b:
        failures.append("non-deterministic outputs")

    print(f"\nValidation: {'FAIL — ' + '; '.join(failures) if failures else 'PASS'}")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
