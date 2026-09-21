"""Transmitter effects (SPEC §5, §13).

Signs come from configuration, never hardcoded through the simulator:
excitatory +1, inhibitory -1, modulatory 0 (loaded and recorded but
excluded from fast excitation/inhibition until a better model exists).
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def edge_effects(nt_types: pd.Series, effects_config: dict[str, float]) -> tuple[np.ndarray, dict]:
    """Per-edge signed transmitter effect + a coverage report.

    Unknown transmitter classes get effect 0 and are reported.
    """
    mapped = nt_types.map(effects_config)
    unknown_mask = mapped.isna()
    report = {
        "classes": nt_types.value_counts(dropna=False).to_dict(),
        "unknownFraction": float(unknown_mask.mean()),
    }
    return mapped.fillna(0.0).to_numpy(dtype=np.float32), report
