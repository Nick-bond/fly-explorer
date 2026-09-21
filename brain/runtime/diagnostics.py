"""Brain diagnostics (SPEC §25)."""

from __future__ import annotations

import numpy as np

ACTIVE_THRESHOLD = 0.01


def make_diagnostics(activity: np.ndarray, connection_count: int,
                     simulation_step: int, simulation_time: float) -> dict:
    return {
        "neuronCount": int(activity.shape[0]),
        "connectionCount": int(connection_count),
        "meanActivity": float(activity.mean()),
        "maxActivity": float(activity.max()),
        "minActivity": float(activity.min()),
        "activeNeuronCount": int((np.abs(activity) > ACTIVE_THRESHOLD).sum()),
        "simulationStep": int(simulation_step),
        "simulationTime": float(simulation_time),
    }
