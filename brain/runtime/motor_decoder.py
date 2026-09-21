"""Motor decoder (SPEC §21–§23).

Reads only the configured output populations (the motor boundary — the
WebGL side never inspects arbitrary neurons) and produces the abstract
FlyMotorOutput:

    forward  -1..1   (negative = flying backward)
    yaw      -1..1
    pitch    -1..1
    vertical -1..1
    lateral  -1..1   (sideways)
    brake     0..1   (damps velocity — stop mid-flight)
    escape    0..1

Population activity is tanh-signed, so a single population per axis
already yields both directions. Empty populations decode to 0. Outputs
are smoothed and clamped.
"""

from __future__ import annotations

import numpy as np

ZERO_OUTPUT = {
    "forward": 0.0, "yaw": 0.0, "pitch": 0.0,
    "vertical": 0.0, "lateral": 0.0, "brake": 0.0, "escape": 0.0,
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class MotorDecoder:
    def __init__(self, group_indices: dict[str, np.ndarray], motor_config: dict) -> None:
        self.groups = group_indices
        self.smoothing = float(motor_config["smoothing"])
        self.forward_gain = float(motor_config["forwardGain"])
        self.yaw_gain = float(motor_config["yawGain"])
        self.vertical_gain = float(motor_config["verticalGain"])
        self.lateral_gain = float(motor_config["lateralGain"])
        self.brake_gain = float(motor_config["brakeGain"])
        self.escape_gain = float(motor_config["escapeGain"])
        self._out = dict(ZERO_OUTPUT)

    def reset(self) -> None:
        self._out = dict(ZERO_OUTPUT)

    def _mean(self, activity: np.ndarray, group: str) -> float:
        indices = self.groups.get(group)
        if indices is None or len(indices) == 0:
            return 0.0
        return float(activity[indices].mean())

    def decode(self, activity: np.ndarray) -> dict:
        raw = {
            "forward": _clamp(self.forward_gain * self._mean(activity, "forward"), -1.0, 1.0),
            "yaw": _clamp(
                self.yaw_gain * (self._mean(activity, "right_turn") - self._mean(activity, "left_turn")),
                -1.0, 1.0,
            ),
            "pitch": _clamp(
                self.yaw_gain * (self._mean(activity, "pitch_up") - self._mean(activity, "pitch_down")),
                -1.0, 1.0,
            ),
            "vertical": _clamp(self.vertical_gain * self._mean(activity, "vertical"), -1.0, 1.0),
            "lateral": _clamp(self.lateral_gain * self._mean(activity, "lateral"), -1.0, 1.0),
            "brake": _clamp(self.brake_gain * self._mean(activity, "brake"), 0.0, 1.0),
            "escape": _clamp(self.escape_gain * self._mean(activity, "escape"), 0.0, 1.0),
        }
        s = self.smoothing
        for key, value in raw.items():
            self._out[key] += s * (value - self._out[key])
        return dict(self._out)
