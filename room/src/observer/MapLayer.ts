import { makeBox, solid, hex, FLOATS_PER_VERT } from '../render/geometry';
import { mat4Identity, mat4Translate } from '../render/math';
import type { Renderer, SceneNode, DynamicMesh } from '../render/Renderer';
import type { Mapper } from './Mapper';

// Draws the mapper's state into the spectator view (never the eyes):
// discovered voxels as translucent cubes colored by height, deaths as
// small red markers. Toggled from the HUD with the M key.

const VOXEL_ALPHA = 0.32;
const VOXEL_FILL = 0.85;    // cube size relative to the voxel, leaves seams
const DEATH_MARKER_SIZE = 0.09;
const DEATH_COLOR = 0xd03a2a;

export class MapLayer {
  visible = true;
  private readonly voxelMesh: DynamicMesh;
  private readonly voxelNode: SceneNode;
  private readonly deathNodes: SceneNode[] = [];
  private readonly deathMesh;
  private drawnDeaths = 0;

  constructor(private readonly renderer: Renderer, private readonly mapper: Mapper) {
    const maxVerts = mapper.reachableVoxels * 36;
    this.voxelMesh = renderer.createDynamicMesh(maxVerts);
    this.voxelNode = {
      mesh: this.voxelMesh,
      model: mat4Identity(),
      rotation: mat4Identity(),
      alpha: VOXEL_ALPHA,
    };
    this.deathMesh = renderer.createMesh(
      makeBox(DEATH_MARKER_SIZE, DEATH_MARKER_SIZE, DEATH_MARKER_SIZE, solid(DEATH_COLOR)),
    );
  }

  // Append newly discovered voxels and new death markers.
  sync(): void {
    for (const id of this.mapper.drainNewVoxels()) {
      this.renderer.appendToMesh(this.voxelMesh, this.voxelGeometry(id));
    }
    while (this.drawnDeaths < this.mapper.deaths.length) {
      const death = this.mapper.deaths[this.drawnDeaths++];
      this.deathNodes.push({
        mesh: this.deathMesh,
        model: mat4Translate(...death.position),
        rotation: mat4Identity(),
      });
    }
  }

  get nodes(): SceneNode[] {
    if (!this.visible) return [];
    return [...this.deathNodes, this.voxelNode];
  }

  private voxelGeometry(id: number): Float32Array {
    const center = this.mapper.voxelCenter(id);
    // Color by height so the 3D structure of the map reads at a glance:
    // teal near the floor blending toward pale green at the ceiling.
    const t = center[1] / 3;
    const low = hex(0x2f8f7a), high = hex(0xa8d97a);
    const color: [number, number, number] = [
      low[0] + (high[0] - low[0]) * t,
      low[1] + (high[1] - low[1]) * t,
      low[2] + (high[2] - low[2]) * t,
    ];
    const size = this.mapper.voxelSize * VOXEL_FILL;
    const geom = makeBox(size, size, size, {
      px: color, nx: color, py: color, ny: color, pz: color, nz: color,
    });
    // Bake the voxel's position into the geometry so the whole map stays
    // one draw call with an identity model matrix.
    for (let v = 0; v < geom.length; v += FLOATS_PER_VERT) {
      geom[v] += center[0];
      geom[v + 1] += center[1];
      geom[v + 2] += center[2];
    }
    return geom;
  }
}
