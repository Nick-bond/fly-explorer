"""Visual encoder (SPEC §18–§19).

    WebGL eye render (RGBA) -> low-resolution projection (16x16 luminance)
    -> visual features -> external_input on the configured populations

Features per eye:
  luminance + temporal difference -> photoreceptors
  looming (radial expansion)      -> LC4 + LPLC2 (the biological looming
                                     detectors, which drive the Giant
                                     Fiber escape through the connectome)

The looming estimate is first-order: for an expanding image the content
moves outward, so dI/dt ~ -v * (r_hat . grad I); the per-sector product
-dI/dt * (r_hat . grad I) is positive under expansion (an approaching
surface) and rectified to zero under contraction (receding).

Only the configured populations receive external stimulation; every
other neuron's external_input stays 0. Each population neuron is
assigned one visual sector round-robin.
"""

from __future__ import annotations

import numpy as np


def _luminance_grid(rgba: np.ndarray, width: int, height: int) -> np.ndarray:
    """(R, R, 4) uint8 -> (height, width) float32 luminance in 0..1."""
    lum = rgba[..., :3].astype(np.float32).mean(axis=-1) / 255.0
    r = lum.shape[0]
    fy, fx = r // height, r // width
    return lum[: height * fy, : width * fx].reshape(height, fy, width, fx).mean(axis=(1, 3))


class VisualEncoder:
    def __init__(self, populations: dict[str, np.ndarray], vision_config: dict) -> None:
        """populations: photo_left, photo_right, loom_left, loom_right."""
        self.width = int(vision_config["width"])
        self.height = int(vision_config["height"])
        self.luminance_gain = float(vision_config["luminanceGain"])
        self.temporal_gain = float(vision_config["temporalGain"])
        self.looming_gain = float(vision_config["loomingGain"])

        sectors = self.width * self.height
        def with_sectors(indices: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            return indices, np.arange(len(indices)) % sectors

        self.photo = {"left": with_sectors(populations["photo_left"]),
                      "right": with_sectors(populations["photo_right"])}
        self.loom = {"left": with_sectors(populations["loom_left"]),
                     "right": with_sectors(populations["loom_right"])}

        # Radial unit vectors from the grid center, for the looming estimate.
        ys, xs = np.mgrid[0:self.height, 0:self.width].astype(np.float32)
        rx, ry = xs - (self.width - 1) / 2, ys - (self.height - 1) / 2
        norm = np.hypot(rx, ry)
        norm[norm == 0] = 1.0
        self._rx, self._ry = rx / norm, ry / norm

        self._prev: dict[str, np.ndarray | None] = {"left": None, "right": None}
        self.last_looming = {"left": 0.0, "right": 0.0}  # diagnostics

    def reset(self) -> None:
        self._prev = {"left": None, "right": None}
        self.last_looming = {"left": 0.0, "right": 0.0}

    def encode(self, left_rgba: np.ndarray, right_rgba: np.ndarray, external_input: np.ndarray) -> None:
        """Write stimulation into external_input (zeroing it first)."""
        external_input.fill(0.0)
        for name, rgba in (("left", left_rgba), ("right", right_rgba)):
            grid = _luminance_grid(rgba, self.width, self.height)
            prev = self._prev[name]
            diff = grid - prev if prev is not None else np.zeros_like(grid)
            self._prev[name] = grid

            # Photoreceptors: luminance + temporal difference.
            photo_signal = (self.luminance_gain * grid + self.temporal_gain * diff).ravel()
            indices, sector_of = self.photo[name]
            external_input[indices] = photo_signal[sector_of]

            # Looming detectors: rectified radial expansion energy.
            gy, gx = np.gradient(grid)
            r_dot_g = gx * self._rx + gy * self._ry
            loom = np.maximum(0.0, -diff * r_dot_g)
            loom_signal = (self.looming_gain * loom).ravel()
            indices, sector_of = self.loom[name]
            external_input[indices] = loom_signal[sector_of]
            self.last_looming[name] = float(loom.mean())
