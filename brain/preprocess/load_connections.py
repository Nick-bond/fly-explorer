"""Load the filtered connection graph (SPEC §4)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

CONNECTIONS_FILE = "connections_princeton.csv.gz"


def load(data_dir: Path, min_synapses: int) -> pd.DataFrame:
    """Connections with syn_count >= min_synapses.

    Columns: pre_root_id, post_root_id, syn_count, nt_type.
    The >= 5 filter reproduces Codex's "Connections (Filtered)" graph
    (~3.7M edges) from the unfiltered export.
    """
    df = pd.read_csv(
        data_dir / CONNECTIONS_FILE,
        usecols=["pre_root_id", "post_root_id", "syn_count", "nt_type"],
        dtype={
            "pre_root_id": np.uint64,
            "post_root_id": np.uint64,
            "syn_count": np.int32,
            "nt_type": "category",
        },
    )
    return df[df["syn_count"] >= min_synapses].reset_index(drop=True)
