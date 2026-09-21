"""Preprocessing pipeline (SPEC §29): raw Codex files -> brain_data/.

    Codex CSV/files -> validate -> join annotations -> root IDs to indices
    -> transmitter effects -> sparse graph -> sensory/motor groups
    -> save optimized brain dataset

Run:  python3 -m brain.preprocess.build_brain
Then the runtime loads brain_data/ instead of re-parsing raw files.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import scipy.sparse as sp

from brain.paths import BRAIN_DATA_DIR, DATA_DIR, load_config
from brain.preprocess import load_connections, load_neurons, load_transmitters

PREPROCESSING_VERSION = "0.1"


def select_sensory_groups(neurons: pd.DataFrame) -> dict:
    """Visual input populations (SPEC §20), chosen from Codex annotations:

    - photoreceptors by eye side receive luminance + temporal difference;
    - LC4 + LPLC2 by side receive the looming (radial expansion) feature —
      these are the biological looming detectors that drive the Giant
      Fiber escape circuit.
    """
    photo = neurons[neurons["visual_family"] == "Photo Receptors"]
    loom = neurons[neurons["visual_type"].isin(["LC4", "LPLC2"])]
    return {
        "visualPopulations": {
            "left": photo.index[photo["visual_side"] == "left"].tolist(),
            "right": photo.index[photo["visual_side"] == "right"].tolist(),
        },
        "loomingPopulations": {
            "left": loom.index[loom["visual_side"] == "left"].tolist(),
            "right": loom.index[loom["visual_side"] == "right"].tolist(),
        },
        "criteria": "photoreceptors by visual_side (luminance+temporal); "
                    "LC4+LPLC2 by visual_side (looming)",
    }


def select_motor_groups(neurons: pd.DataFrame) -> dict:
    """Motor boundary populations (SPEC §21–§23): descending neurons.

    All populations are real FlyWire DN families; assigning each family
    to a motor axis is an explicit MODELING ASSUMPTION of v0.1 (activity
    is signed via tanh, so one population per axis yields both
    directions — e.g. negative forward = flying backward):

      yaw      = mean(right_turn) - mean(left_turn)  (all DN, by side)
      forward  = signed mean(DNp*)   posterior DNs (flight motor)
      vertical = signed mean(DNa*)   anterior DNs (steering)
      lateral  = signed mean(DNb*)
      brake    = positive mean(DNg*)
      escape   = Giant Fiber (DNp01)
    """
    dn = neurons[neurons["super_class"] == "descending"]

    def family(prefix: str) -> list[int]:
        return dn.index[dn["primary_type"].str.startswith(prefix, na=False)].tolist()

    return {
        "left_turn": dn.index[dn["side"] == "left"].tolist(),
        "right_turn": dn.index[dn["side"] == "right"].tolist(),
        "forward": family("DNp"),
        "vertical": family("DNa"),
        "lateral": family("DNb"),
        "brake": family("DNg"),
        "pitch_up": [],
        "pitch_down": [],
        "escape": neurons.index[neurons["primary_type"] == "DNp01"].tolist(),
        "criteria": "descending by side (yaw); DN families DNp/DNa/DNb/DNg as "
                    "forward/vertical/lateral/brake (modeling assumption); escape = DNp01",
    }


def build() -> None:
    config = load_config()
    pre_cfg = config["preprocess"]
    BRAIN_DATA_DIR.mkdir(exist_ok=True)

    print("loading neurons + annotations ...")
    neurons = load_neurons.load(DATA_DIR)
    n = len(neurons)

    print("loading filtered connections ...")
    connections = load_connections.load(DATA_DIR, pre_cfg["minSynapses"])

    # --- Validation stage 1 (SPEC §31) -------------------------------
    problems: list[str] = []

    known = neurons.index
    valid_mask = connections["pre_root_id"].isin(known) & connections["post_root_id"].isin(known)
    dropped = int((~valid_mask).sum())
    if dropped:
        connections = connections[valid_mask].reset_index(drop=True)

    if (connections["syn_count"] <= 0).any():
        problems.append("non-positive synapse counts found")

    effects, nt_report = load_transmitters.edge_effects(
        connections["nt_type"], pre_cfg["transmitterEffects"]
    )

    # --- Root IDs -> compact indices (SPEC §10) ----------------------
    root_ids = neurons.index.to_numpy(dtype=np.uint64)
    index_of = pd.Series(np.arange(n, dtype=np.int32), index=neurons.index)
    pre_idx = index_of[connections["pre_root_id"]].to_numpy()
    post_idx = index_of[connections["post_root_id"]].to_numpy()

    # --- Weights + sparse graph (SPEC §12–§13) -----------------------
    weights = (
        connections["syn_count"].to_numpy(dtype=np.float32)
        * effects
        * np.float32(config["simulation"]["globalWeightScale"])
    )
    if not np.isfinite(weights).all():
        problems.append("NaN/inf weights found")

    # incoming = W @ activity  =>  rows are POST, cols are PRE.
    W = sp.csr_matrix((weights, (post_idx, pre_idx)), shape=(n, n), dtype=np.float32)

    # --- Sensory / motor groups (SPEC §20–§23) -----------------------
    sensory = select_sensory_groups(neurons)
    motor = select_motor_groups(neurons)
    n_vis_l = len(sensory["visualPopulations"]["left"])
    n_vis_r = len(sensory["visualPopulations"]["right"])
    if n_vis_l == 0 or n_vis_r == 0:
        problems.append("empty visual population")
    n_loom_l = len(sensory["loomingPopulations"]["left"])
    n_loom_r = len(sensory["loomingPopulations"]["right"])
    if n_loom_l == 0 or n_loom_r == 0:
        problems.append("empty looming population")
    if len(motor["left_turn"]) == 0 or len(motor["right_turn"]) == 0:
        problems.append("empty descending population")
    if len(motor["escape"]) == 0:
        problems.append("empty escape population (no DNp01)")

    # --- Save optimized dataset (SPEC §29–§30) -----------------------
    np.save(BRAIN_DATA_DIR / "root_ids.npy", root_ids)
    sp.save_npz(BRAIN_DATA_DIR / "connectivity.npz", W)
    neurons.to_parquet(BRAIN_DATA_DIR / "neuron_metadata.parquet")
    with open(BRAIN_DATA_DIR / "sensory_groups.json", "w") as f:
        json.dump(sensory, f)
    with open(BRAIN_DATA_DIR / "motor_groups.json", "w") as f:
        json.dump(motor, f)

    source_files = {
        p.name: p.stat().st_size
        for p in sorted(DATA_DIR.glob("*.gz"))
    }
    metadata = {
        "dataset": config["dataset"]["name"],
        "datasetVersion": config["dataset"]["version"],
        "neuronCount": int(n),
        "connectionCount": int(W.nnz),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceFiles": source_files,
        "preprocessingVersion": PREPROCESSING_VERSION,
        "config": config,
        "droppedEdgesUnknownNeurons": dropped,
        "transmitters": nt_report,
    }
    with open(BRAIN_DATA_DIR / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    # --- Report (SPEC §31) -------------------------------------------
    print()
    print(f"Dataset: {metadata['dataset']} ({metadata['datasetVersion']})")
    print(f"Neurons: {n:,}")
    print(f"Connections: {W.nnz:,} (dropped {dropped:,} referencing unknown neurons)")
    print()
    print(f"Unknown transmitter: {nt_report['unknownFraction']:.1%}")
    for cls, count in nt_report["classes"].items():
        effect = pre_cfg["transmitterEffects"].get(cls, "?")
        print(f"  {cls}: {count:,} (effect {effect})")
    print()
    print(f"Visual neurons selected: {n_vis_l:,} left / {n_vis_r:,} right")
    print(f"Looming detectors (LC4+LPLC2): {n_loom_l} left / {n_loom_r} right")
    print(f"Descending selected: {len(motor['left_turn']):,} left / {len(motor['right_turn']):,} right")
    print(f"Motor axes: forward(DNp)={len(motor['forward'])} vertical(DNa)={len(motor['vertical'])} "
          f"lateral(DNb)={len(motor['lateral'])} brake(DNg)={len(motor['brake'])}")
    print(f"Escape (DNp01): {len(motor['escape'])}")
    print()
    print(f"Validation: {'FAIL — ' + '; '.join(problems) if problems else 'PASS'}")
    print(f"\nwritten to {BRAIN_DATA_DIR}/")


if __name__ == "__main__":
    build()
