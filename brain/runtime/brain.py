"""FlyBrain (SPEC §24): the ~139k-neuron network runtime.

Loads the preprocessed brain_data/ dataset (run
`python3 -m brain.preprocess.build_brain` first), keeps the neuron state
arrays, and advances the rate dynamics on its own fixed clock
(brain_dt, default 10 ms = 100 Hz) via an accumulator — never one
neural update per rendered frame (SPEC §15).

Deterministic: same dataset + config + sensory input -> same outputs.
No learning in v0.1: weights are constant within and across episodes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np
import scipy.sparse as sp

from brain.paths import BRAIN_DATA_DIR, load_config
from brain.runtime.diagnostics import make_diagnostics
from brain.runtime.dynamics import RateDynamics
from brain.runtime.motor_decoder import ZERO_OUTPUT, MotorDecoder
from brain.runtime.sensory_encoder import VisualEncoder


@dataclass
class FlySensoryInput:
    """Everything the brain is allowed to sense (SPEC §17).

    No global position, no room geometry, no map. Angular velocity is
    carried for future vestibular-like populations; v0.1 encodes vision
    only.
    """
    left_eye: np.ndarray   # (R, R, 4) uint8
    right_eye: np.ndarray  # (R, R, 4) uint8
    angular_velocity: dict = field(default_factory=lambda: {"yaw": 0.0, "pitch": 0.0, "roll": 0.0})


class FlyBrain:
    def __init__(self, config: dict | None = None, data_dir=BRAIN_DATA_DIR) -> None:
        self.config = config or load_config()
        self.data_dir = data_dir
        self.initialized = False

    def initialize(self) -> None:
        with open(self.data_dir / "metadata.json") as f:
            self.metadata = json.load(f)
        self.root_ids = np.load(self.data_dir / "root_ids.npy")
        self.index_of = {int(r): i for i, r in enumerate(self.root_ids)}
        W = sp.load_npz(self.data_dir / "connectivity.npz")
        with open(self.data_dir / "sensory_groups.json") as f:
            sensory_groups = json.load(f)
        with open(self.data_dir / "motor_groups.json") as f:
            motor_groups = json.load(f)

        sim = self.config["simulation"]
        self.brain_dt = float(sim["dt"])
        self.max_steps_per_update = int(sim["maxStepsPerUpdate"])
        self.dynamics = RateDynamics(W, sim["decay"], sim["inputScale"])

        def to_indices(root_ids: list[int]) -> np.ndarray:
            return np.array([self.index_of[r] for r in root_ids if r in self.index_of], dtype=np.int64)

        photo = sensory_groups["visualPopulations"]
        loom = sensory_groups["loomingPopulations"]
        self.encoder = VisualEncoder({
            "photo_left": to_indices(photo["left"]),
            "photo_right": to_indices(photo["right"]),
            "loom_left": to_indices(loom["left"]),
            "loom_right": to_indices(loom["right"]),
        }, self.config["vision"])
        self.decoder = MotorDecoder(
            {name: to_indices(ids) for name, ids in motor_groups.items() if isinstance(ids, list)},
            self.config["motor"],
        )

        n = len(self.root_ids)
        self.activity = np.zeros(n, dtype=np.float32)
        self.external_input = np.zeros(n, dtype=np.float32)
        self.simulation_step = 0
        self.simulation_time = 0.0
        self._accumulator = 0.0
        self.initialized = True

    # SPEC §16: activity and temporal state reset; connectivity stays loaded.
    def reset(self) -> None:
        self.activity.fill(0.0)
        self.external_input.fill(0.0)
        self.simulation_step = 0
        self.simulation_time = 0.0
        self._accumulator = 0.0
        self.encoder.reset()
        self.decoder.reset()

    def step(self, sensory: FlySensoryInput, dt: float) -> dict:
        """One sensory-motor update: encode -> 0..N fixed brain steps -> decode."""
        if not self.initialized:
            return dict(ZERO_OUTPUT)

        self.encoder.encode(sensory.left_eye, sensory.right_eye, self.external_input)

        self._accumulator += dt
        steps = min(int(self._accumulator / self.brain_dt), self.max_steps_per_update)
        self._accumulator -= steps * self.brain_dt
        for _ in range(steps):
            self.activity = self.dynamics.step(self.activity, self.external_input)
            self.simulation_step += 1
            self.simulation_time += self.brain_dt

        return self.decoder.decode(self.activity)

    def get_neuron_activity(self, root_ids: list[int] | None = None) -> np.ndarray:
        if root_ids is None:
            return self.activity
        indices = [self.index_of[r] for r in root_ids if r in self.index_of]
        return self.activity[indices]

    def get_diagnostics(self) -> dict:
        return make_diagnostics(
            self.activity, self.dynamics.W.nnz, self.simulation_step, self.simulation_time
        )
