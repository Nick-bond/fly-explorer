"""Neural dynamics v0.1 (SPEC §14): continuous-rate model.

    incoming = W @ activity
    state    = decay * activity + input_scale * incoming + external_input
    activity = tanh(state)

W is sparse CSR with rows = postsynaptic, cols = presynaptic, weights
already signed by transmitter effect and scaled (built by preprocessing).
Deterministic: no randomness in the update.
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sp


class RateDynamics:
    def __init__(self, W: sp.csr_matrix, decay: float, input_scale: float) -> None:
        self.W = W
        self.decay = np.float32(decay)
        self.input_scale = np.float32(input_scale)

    def step(self, activity: np.ndarray, external_input: np.ndarray) -> np.ndarray:
        incoming = self.W @ activity
        state = self.decay * activity + self.input_scale * incoming + external_input
        return np.tanh(state, out=state)
