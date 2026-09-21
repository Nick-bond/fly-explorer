"""Load neurons with all annotations joined (SPEC §6–§8)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

NEURONS_FILE = "neurons.csv.gz"
CLASSIFICATION_FILE = "classification.csv.gz"
CELL_TYPES_FILE = "consolidated_cell_types.csv.gz"
VISUAL_TYPES_FILE = "visual_neuron_types.csv.gz"


def load(data_dir: Path) -> pd.DataFrame:
    """One row per neuron, indexed by root_id.

    Annotations are metadata only — they never modify activity directly.
    """
    neurons = pd.read_csv(
        data_dir / NEURONS_FILE, index_col="root_id",
        usecols=["root_id", "group", "nt_type"],
    )
    classification = pd.read_csv(
        data_dir / CLASSIFICATION_FILE, index_col="root_id",
        usecols=["root_id", "flow", "super_class", "class", "sub_class", "side"],
    )
    cell_types = pd.read_csv(
        data_dir / CELL_TYPES_FILE, index_col="root_id",
        usecols=["root_id", "primary_type"],
    )
    visual = pd.read_csv(
        data_dir / VISUAL_TYPES_FILE, index_col="root_id",
        usecols=["root_id", "type", "family", "subsystem", "side"],
    ).rename(columns={
        "type": "visual_type",
        "family": "visual_family",
        "subsystem": "visual_subsystem",
        "side": "visual_side",
    })

    return neurons.join(classification).join(cell_types).join(visual)
