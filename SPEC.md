# Fly Brain + Data Specification v0.1

## 1. Purpose

The Fly Brain subsystem controls the virtual fly actor inside the WebGL environment.

The subsystem must:

* use the FlyWire FAFB connectome as its neural connectivity graph;
* receive only biologically inspired sensory signals from the environment;
* propagate activity through the connectome over time;
* read activity from selected output/descending neurons;
* convert that activity into abstract motor commands for the WebGL fly;
* remain completely independent from the 3D mapping/evaluation subsystem.

The goal of v0.1 is **not** to reproduce a biologically exact fruit-fly brain.

The goal is to create a deterministic, inspectable neural dynamical system whose topology is based on the real FlyWire connectome.

---

# 2. System Architecture

```text
                 WEBGL ENVIRONMENT
                         │
                         │
                  rendered fly vision
                  self-motion signals
                         │
                         ▼
                ┌─────────────────┐
                │ SENSORY ENCODER │
                └────────┬────────┘
                         │
                    neural inputs
                         │
                         ▼
                ┌─────────────────┐
                │   FLY BRAIN     │
                │                 │
                │ ~139k neurons   │
                │ sparse graph    │
                │ neural dynamics │
                └────────┬────────┘
                         │
                 output populations
                         │
                         ▼
                ┌─────────────────┐
                │ MOTOR DECODER   │
                └────────┬────────┘
                         │
                         │
                abstract motor values
                         │
                         ▼
                    WEBGL FLY
```

A completely separate observer system may access the true simulation coordinates and produce the 3D exploration map.

---

# 3. Dataset

Dataset:

```text
FlyWire FAFB
Female Adult Fly Brain
```

Use the current Codex FAFB dataset.

Primary identity:

```text
dataset = FAFB
```

The brain loader must record the dataset version used for every experiment.

Example:

```json
{
  "dataset": "FAFB",
  "datasetVersion": "v783"
}
```

Never silently mix data from different FlyWire/Codex versions.

---

# 4. Required Data Files

## 4.1 Connections — REQUIRED

Use:

```text
Connections (Filtered)
```

This is the main neural graph.

Each connection represents approximately:

```text
presynaptic neuron
        │
        │ N synapses
        ▼
postsynaptic neuron
```

Required normalized fields:

```text
pre_root_id
post_root_id
synapse_count
```

Internal representation:

```ts
interface Connection {
    pre: number;
    post: number;
    synapseCount: number;
    weight: number;
}
```

For v0.1, use the filtered graph rather than the unfiltered graph.

---

# 5. Neurotransmitter Data — REQUIRED

Use:

```text
Neurotransmitter Type Predictions
```

Required normalized fields should eventually contain:

```text
root_id
predicted_transmitter
confidence
```

Possible classes may include neurotransmitters such as:

```text
acetylcholine
GABA
glutamate
dopamine
serotonin
octopamine
others
```

For v0.1 define transmitter behavior through configuration rather than hardcoding it throughout the simulator.

Example:

```json
{
  "acetylcholine": 1.0,
  "GABA": -1.0,
  "glutamate": -1.0,
  "dopamine": 0.0,
  "serotonin": 0.0,
  "octopamine": 0.0
}
```

`0.0` means:

```text
loaded and recorded,
but excluded from simple fast excitation/inhibition
until a better modulatory model exists.
```

These mappings are modeling assumptions and must be configurable.

---

# 6. Cell-Type Data — REQUIRED

Use:

```text
Cell Types
```

Purpose:

```text
neuron ID
   ↓
known biological identity
```

Required normalized structure:

```ts
interface NeuronAnnotation {
    rootId: bigint;
    cellType?: string;
}
```

Annotations are metadata.

They do not directly modify neural activity.

---

# 7. Classification Data — RECOMMENDED

Use:

```text
Classification / Hierarchical Annotations
```

Purpose:

identify broad functional groups.

Useful fields may include concepts such as:

```text
super_class
class
sub_class
flow
side
nerve
hemilineage
```

We especially need this to find:

```text
visual neurons
projection neurons
descending neurons
sensory-related populations
motor-related populations
```

The exact source columns should be normalized when the downloaded files are inspected.

---

# 8. Visual Annotation Data — REQUIRED FOR VISION INTEGRATION

Use:

```text
Visual Neuron Annotations
```

Purpose:

identify neurons participating in the fly visual system.

Future versions may also use:

```text
Visual Neuron Columns
```

to map spatial regions of the virtual visual field onto biologically meaningful optic-lobe columns.

v0.1 does not require column-accurate vision.

---

# 9. Data Not Required For Brain v0.1

Do not initially load:

```text
Synapse Table
Neuron Skeletons
Community Labels
Neuron Coordinates
Cell Size Measurements
old Buhmann connection files
old synapse coordinates
synapse attachment statistics
```

These can be incorporated later.

The brain runtime should therefore initially operate on:

```text
~139k nodes
~3.7M filtered directed edges
```

rather than tens of millions of individual synapse objects.

---

# 10. Internal Neuron IDs

FlyWire root IDs are preserved as external identifiers.

Example:

```text
720575940621039145
```

At load time create compact internal indices:

```text
FlyWire root ID             internal ID

720575940621039145    →          0
720575940622843221    →          1
720575940631233817    →          2
...
```

Create both mappings:

```python
root_id_to_index
index_to_root_id
```

All runtime neural arrays use compact integer indices.

---

# 11. Brain State

For N neurons maintain contiguous arrays.

Minimum v0.1 state:

```text
activity[N]
next_activity[N]
external_input[N]
```

Recommended type:

```text
float32
```

Optional future state:

```text
membrane_voltage[N]
refractory_state[N]
adaptation[N]
last_spike_time[N]
```

These are not required for v0.1.

---

# 12. Sparse Connectivity Representation

Never construct:

```text
139255 × 139255
```

as a dense matrix.

Connectivity must use a sparse representation.

Recommended CPU representation:

```text
CSR — Compressed Sparse Row
```

or equivalent edge arrays:

```text
pre[]
post[]
weight[]
```

An implementation should support efficient operations equivalent to:

```text
incoming = W × activity
```

where `W` is sparse.

---

# 13. Initial Connection Weights

Raw anatomical strength:

```text
raw_strength = synapse_count
```

Initial signed strength:

```text
signed_strength =
    synapse_count
    × transmitter_effect
```

Normalized strength:

```text
weight =
    signed_strength
    × global_weight_scale
```

Example:

```text
ACh neuron
17 synapses

17 × +1 × scale
```

versus:

```text
GABA neuron
12 synapses

12 × -1 × scale
```

`global_weight_scale` must be configuration-driven.

Example:

```json
{
  "globalWeightScale": 0.01
}
```

The correct value must be established empirically through stability testing.

---

# 14. Neural Dynamics v0.1

Use a continuous-rate model rather than individual action potentials.

For neuron `i`:

```text
input_i =
    sum(weight[j → i] × activity[j])
    +
    external_input[i]
```

Update:

```text
state_i =
    decay × previous_activity_i
    +
    input_scale × input_i
```

Activation:

```text
activity_i = tanh(state_i)
```

Equivalent conceptual implementation:

```python
incoming = W @ activity

state = (
    decay * activity
    + input_scale * incoming
    + external_input
)

activity = tanh(state)
```

Initial configurable parameters:

```json
{
  "decay": 0.90,
  "inputScale": 0.05,
  "globalWeightScale": 0.01
}
```

These are experimental defaults, not biological constants.

---

# 15. Simulation Clock

The brain must run on its own fixed timestep.

Recommended initial value:

```text
brain_dt = 10 ms
brain_frequency = 100 Hz
```

The WebGL renderer may run independently:

```text
rendering ≈ 60 Hz
brain ≈ 100 Hz
```

Do not assume one neural update per rendered frame.

Use an accumulator:

```text
WebGL frame
    ↓
elapsed time
    ↓
run 0..N brain steps
```

This keeps simulation behavior independent of GPU frame rate.

---

# 16. Brain Reset

Every new fly episode resets:

```text
activity = 0
external_input = 0
internal temporal state = 0
```

Dataset/connectivity remains loaded.

Function:

```ts
brain.reset()
```

v0.1 does not preserve learned neural state between deaths.

---

# 17. Sensory Interface

The brain cannot access:

```text
global XYZ
room dimensions
box positions
distance-to-wall values
3D world map
ground-truth geometry
```

Allowed v0.1 sensory information:

```text
visual signals
angular velocity
optional linear acceleration
```

Interface:

```ts
interface FlySensoryInput {
    vision: Float32Array;

    angularVelocity: {
        yaw: number;
        pitch: number;
        roll: number;
    };
}
```

---

# 18. Vision v0.1

Do not feed raw HD RGB frames directly into the connectome.

Pipeline:

```text
WebGL eye render
       ↓
low-resolution projection
       ↓
visual features
       ↓
sensory neuron stimulation
```

Start with two virtual eyes.

Each eye may initially be represented as:

```text
16 × 16
```

or:

```text
32 × 32
```

visual regions.

For every region calculate:

```text
luminance
temporal change
horizontal motion estimate
vertical motion estimate
looming / expansion estimate
```

The first minimal implementation can use only:

```text
luminance
temporal difference
```

before adding optical-flow signals.

---

# 19. Visual Encoder

Component:

```text
VisualEncoder
```

Input:

```text
processed WebGL eye data
```

Output:

```text
external_input[N]
```

Only selected visual neurons receive direct external stimulation.

Conceptually:

```text
eye sector #27
      ↓
VisualEncoder
      ↓
selected left optic-lobe population
      ↓
external_input[index] += signal
```

All other neurons must receive:

```text
external_input = 0
```

unless they correspond to another explicit sensory source.

---

# 20. Visual Population Configuration

Sensory mappings must live in configuration/data, not source-code constants.

Example:

```json
{
  "visualPopulations": {
    "left": [
      720575940000000001,
      720575940000000002
    ],
    "right": [
      720575940000000003,
      720575940000000004
    ]
  }
}
```

Eventually this configuration should be generated from Codex annotations.

---

# 21. Motor Boundary

The WebGL simulator must not directly inspect arbitrary neurons.

A defined set of output populations forms the brain's motor boundary.

Initial target:

```text
descending neurons
```

Conceptually:

```text
entire connectome
      ↓
descending populations
      ↓
MotorDecoder
```

---

# 22. Motor Output Interface

The brain outputs abstract control values.

```ts
interface FlyMotorOutput {
    forward: number;
    yaw: number;
    pitch: number;
    vertical: number;
    escape: number;
}
```

Ranges:

```text
forward:   0..1
yaw:      -1..1
pitch:    -1..1
vertical: -1..1
escape:    0..1
```

These values are not wing muscle commands.

They are the interface between neural simulation and simplified WebGL body physics.

---

# 23. Motor Decoder

The MotorDecoder reads defined neuron populations.

Example:

```text
left-turn population
right-turn population
forward population
ascending population
descending population
escape population
```

Example decoding:

```text
yaw =
    mean(right_turn)
    -
    mean(left_turn)
```

and:

```text
vertical =
    mean(up)
    -
    mean(down)
```

Output must be normalized/clamped.

Example:

```text
yaw ∈ [-1, +1]
```

The exact biological populations must be selected from FlyWire annotations rather than invented neuron IDs.

---

# 24. Brain API

The brain subsystem exposes:

```ts
interface FlyBrain {

    initialize(): Promise<void>;

    reset(): void;

    step(
        sensory: FlySensoryInput,
        dt: number
    ): FlyMotorOutput;

    getNeuronActivity(
        ids?: bigint[]
    ): Float32Array;

    getDiagnostics(): BrainDiagnostics;
}
```

---

# 25. Diagnostics API

Diagnostics should include:

```ts
interface BrainDiagnostics {
    neuronCount: number;
    connectionCount: number;

    meanActivity: number;
    maxActivity: number;
    minActivity: number;

    activeNeuronCount: number;

    simulationStep: number;
    simulationTime: number;
}
```

These values are critical during development.

---

# 26. Runtime Separation

Recommended v0.1 implementation:

```text
Browser/WebGL
     │
     │ WebSocket
     ▼
Python Brain Process
```

Python handles:

```text
dataset loading
sparse matrices
neural simulation
sensory encoding
motor decoding
brain diagnostics
```

Browser handles:

```text
WebGL rendering
fly body
room physics
eye cameras
collision detection
mapping/evaluation
```

---

# 27. Communication Protocol

Browser → Brain:

```json
{
  "type": "sensory",
  "episode": 12,
  "simulationTime": 18.43,
  "vision": [],
  "angularVelocity": {
    "yaw": 0.13,
    "pitch": -0.03,
    "roll": 0.01
  }
}
```

Brain → Browser:

```json
{
  "type": "motor",
  "episode": 12,
  "simulationTime": 18.43,
  "forward": 0.41,
  "yaw": -0.18,
  "pitch": 0.03,
  "vertical": 0.06,
  "escape": 0.0
}
```

Binary transport should replace JSON arrays once vision/neural data becomes large.

---

# 28. Brain Configuration

Example:

```json
{
  "dataset": {
    "name": "FAFB",
    "version": "v783"
  },

  "simulation": {
    "dt": 0.01,
    "decay": 0.90,
    "inputScale": 0.05,
    "globalWeightScale": 0.01
  },

  "vision": {
    "width": 16,
    "height": 16,
    "eyes": 2
  },

  "motor": {
    "smoothing": 0.2
  }
}
```

Every experiment must save its complete configuration.

---

# 29. Data Preprocessing Pipeline

Raw downloaded files should not be parsed on every startup.

Create a preprocessing stage:

```text
Codex CSV/files
      ↓
validate
      ↓
join annotations
      ↓
convert root IDs → integer indices
      ↓
assign transmitter effects
      ↓
construct sparse graph
      ↓
identify configured sensory/output groups
      ↓
save optimized brain dataset
```

Recommended output:

```text
brain_data/
    metadata.json
    root_ids.npy
    connectivity.npz
    neuron_metadata.parquet
    sensory_groups.json
    motor_groups.json
```

---

# 30. Metadata

`metadata.json` must record:

```json
{
  "dataset": "FAFB",
  "datasetVersion": "v783",
  "neuronCount": 139255,
  "connectionCount": 3732460,
  "generatedAt": "...",
  "sourceFiles": {},
  "preprocessingVersion": "0.1"
}
```

Counts must be derived from the downloaded files rather than blindly hardcoded.

---

# 31. Validation Stage 1 — Data

Before running neural dynamics verify:

```text
all connections reference known neurons
synapse counts > 0
no invalid indices
no NaN weights
no infinite weights
transmitter classes are accounted for
sensory IDs exist
motor IDs exist
```

Print a report.

Example:

```text
Dataset: FAFB
Neurons: 139255
Connections: 3732460

Unknown transmitter: 2.3%
ACh: ...
GABA: ...
Glutamate: ...

Visual neurons selected: ...
Descending neurons selected: ...

Validation: PASS
```

---

# 32. Validation Stage 2 — Dynamics

Run the brain disconnected from WebGL.

Stimulate a small known population.

Measure:

```text
activity over time
number of active neurons
activity distribution
propagation depth
output-neuron response
```

The system must not immediately:

```text
saturate every neuron
collapse permanently to zero
produce NaN
oscillate numerically without bound
```

---

# 33. Validation Stage 3 — Sensory Causality

Create synthetic input:

```text
LEFT VISUAL STIMULUS
```

Verify:

```text
VisualEncoder
    ↓
correct visual population
    ↓
connectome propagation
    ↓
measurable downstream activity
```

Then repeat for:

```text
RIGHT VISUAL STIMULUS
LOOMING STIMULUS
FULL-FIELD MOTION
```

---

# 34. Validation Stage 4 — WebGL Integration

Only after stages 1–3 pass:

```text
WebGL eye
   ↓
brain
   ↓
motor output
   ↓
fly actor moves
```

First integration test:

```text
stationary fly
+
manually moving visual object
```

Do not begin with autonomous exploration.

---

# 35. Experiment Logging

Every episode records:

```text
dataset version
brain configuration
initial fly state
simulation seed
sensory input summary
motor output
selected neural activity
trajectory
death reason
simulation duration
map coverage
```

Do not save all 139k neuron activities every millisecond by default.

Instead record:

```text
selected populations
periodic whole-brain snapshots
summary statistics
```

Full recording can be enabled for short debugging runs.

---

# 36. Determinism

Given:

```text
same dataset
same configuration
same sensory input
same random seed
```

the brain must produce identical outputs.

This is essential for experiments.

---

# 37. Performance Targets

Initial target:

```text
139k neurons
~3.7M edges
100 neural updates / second
```

Desired:

```text
≥ real-time simulation speed
```

Real-time is not mandatory initially.

If brain simulation takes:

```text
10 seconds of computation
```

to simulate:

```text
1 second of fly time
```

that is acceptable during development.

Correctness and observability come first.

---

# 38. Learning

Brain v0.1 has:

```text
NO synaptic learning
NO reinforcement learning
NO weight mutation
NO evolutionary optimization
```

Weights remain constant during an episode and across episodes.

This lets us study what behavior emerges from the chosen connectome dynamics before adding adaptation.

Learning can become a separate v0.2/v0.3 experiment.

---

# 39. Death

When WebGL reports:

```text
fly.dead = true
```

the brain stops advancing.

Next episode:

```text
brain.reset()
```

No previous neural activity survives.

The brain receives no explicit concept called:

```text
death
```

A run simply terminates.

---

# 40. Mapping Isolation

The 3D mapper is forbidden from sending information into:

```text
VisualEncoder
FlyBrain
MotorDecoder
```

Therefore:

```text
Fly Brain → World

World → sensory information → Fly Brain
```

while:

```text
World + fly trajectory
        ↓
      Mapper
```

is observation only.

This avoids accidentally giving the fly perfect localization or map knowledge.

---

# 41. Source Directory

Recommended structure:

```text
fly-experiment/
│
├── data/
│   ├── raw/
│   └── processed/
│
├── brain/
│   ├── preprocess/
│   │   ├── load_connections.py
│   │   ├── load_neurons.py
│   │   ├── load_transmitters.py
│   │   └── build_brain.py
│   │
│   ├── runtime/
│   │   ├── brain.py
│   │   ├── dynamics.py
│   │   ├── sensory_encoder.py
│   │   ├── motor_decoder.py
│   │   └── diagnostics.py
│   │
│   ├── server/
│   │   └── server.py
│   │
│   └── config/
│       ├── brain.json
│       ├── sensory_groups.json
│       └── motor_groups.json
│
└── web/
    ├── environment/
    ├── fly/
    ├── vision/
    └── brain-client/
```

---

# 42. Development Milestones

## M0 — Data loads

Success means:

```text
139k-ish neurons loaded
millions of filtered connections loaded
annotations joined
no missing-index errors
```

## M1 — Brain runs

Success means:

```text
brain.step()
```

can execute repeatedly without instability.

## M2 — Artificial stimulation propagates

```text
selected neurons stimulated
      ↓
downstream neurons respond
```

## M3 — Real visual populations identified

Use FlyWire annotations to establish actual sensory input groups.

## M4 — Descending populations identified

Establish real neural populations that will form our motor boundary.

## M5 — Input → output causal test

```text
visual stimulus
     ↓
connectome
     ↓
descending-neuron response
```

## M6 — WebGL connection

```text
WebGL vision
     ↓
brain
     ↓
motor command
     ↓
WebGL fly
```

## M7 — Autonomous run

Fly starts in the room without external control.

Measure:

```text
survival
trajectory
exploration
map coverage
neural activity
```

---

# 43. Definition of Brain v0.1 Complete

Brain v0.1 is complete when:

```text
✓ FlyWire data is reproducibly imported

✓ ~139k neuron network can run continuously

✓ anatomical connection strengths influence propagation

✓ neurotransmitter information influences connection sign/model

✓ identified visual populations can be stimulated

✓ identified descending populations can be observed

✓ WebGL visual input reaches the network

✓ network activity generates motor output

✓ fly moves without scripted steering

✓ mapper remains independent

✓ every run is reproducible and logged
```

Brain v0.1 does **not** require the fly to successfully explore the room.

Getting meaningful exploration is an experimental result, not an implementation requirement.
