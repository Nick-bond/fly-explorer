import type { Room } from '../env/Room';
import type { Observation } from '../env/types';

// The observer/mapper subsystem (SPEC §2, §35, §40).
//
// It reads the fly's PRIVILEGED true coordinates to build the 3D
// exploration map and the death statistics. Information flows one way:
//   world + fly trajectory -> mapper.
// Nothing here may ever reach the brain, the encoder or the decoder —
// the fly earns no localization from being observed.

export interface DeathRecord {
  episode: number;
  position: [number, number, number];
  simTime: number;
  softContacts: number;
  minorContacts: number;
}

export interface CoverageStats {
  episode: number;
  deaths: number;
  visitedVoxels: number;
  reachableVoxels: number;
  coverage: number;         // 0..1, cumulative across all episodes
  episodeVisited: number;
  episodeCoverage: number;  // 0..1, current episode only
}

export class Mapper {
  readonly voxelSize: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly reachableVoxels: number;

  readonly deaths: DeathRecord[] = [];
  private readonly visited: Uint8Array;
  private readonly blocked: Uint8Array;
  private visitedCount = 0;
  private episodeVisitedCount = 0;
  private currentEpisode = 0;
  private wasAlive = true;
  private newlyVisited: number[] = []; // voxel ids since last drain (for the renderer)

  constructor(private readonly room: Room, { voxelSize = 0.25 } = {}) {
    this.voxelSize = voxelSize;
    this.nx = Math.round(room.width / voxelSize);
    this.ny = Math.round(room.height / voxelSize);
    this.nz = Math.round(room.depth / voxelSize);

    const total = this.nx * this.ny * this.nz;
    this.visited = new Uint8Array(total);
    this.blocked = new Uint8Array(total);

    // A voxel whose center sits inside an obstacle box is unreachable and
    // excluded from the coverage denominator.
    let blockedCount = 0;
    for (let id = 0; id < total; id++) {
      if (room.isPointInObstacle(this.voxelCenter(id))) {
        this.blocked[id] = 1;
        blockedCount++;
      }
    }
    this.reachableVoxels = total - blockedCount;
  }

  voxelCenter(id: number): [number, number, number] {
    const ix = id % this.nx;
    const iy = Math.floor(id / this.nx) % this.ny;
    const iz = Math.floor(id / (this.nx * this.ny));
    const b = this.room.bounds;
    return [
      b.minX + (ix + 0.5) * this.voxelSize,
      b.minY + (iy + 0.5) * this.voxelSize,
      b.minZ + (iz + 0.5) * this.voxelSize,
    ];
  }

  private voxelId(p: readonly number[]): number | null {
    const b = this.room.bounds;
    const ix = Math.floor((p[0] - b.minX) / this.voxelSize);
    const iy = Math.floor((p[1] - b.minY) / this.voxelSize);
    const iz = Math.floor((p[2] - b.minZ) / this.voxelSize);
    if (ix < 0 || ix >= this.nx || iy < 0 || iy >= this.ny || iz < 0 || iz >= this.nz) return null;
    return ix + iy * this.nx + iz * this.nx * this.ny;
  }

  // Feed one observation per frame. Marks the fly's voxel as discovered
  // and records the death when alive flips to false.
  update(obs: Observation): void {
    const t = obs.telemetry;
    if (obs.episode !== this.currentEpisode) {
      this.currentEpisode = obs.episode;
      this.episodeVisitedCount = 0;
      this.wasAlive = true;
    }

    if (t.alive) {
      const id = this.voxelId(t.position);
      if (id !== null && !this.visited[id]) {
        this.visited[id] = 1;
        this.visitedCount++;
        this.newlyVisited.push(id);
      }
      if (id !== null) this.episodeVisitedCount = this.countEpisodeApprox(id);
    } else if (this.wasAlive) {
      this.deaths.push({
        episode: obs.episode,
        position: [...t.position],
        simTime: obs.simTime,
        softContacts: t.softContacts,
        minorContacts: t.minorContacts,
      });
    }
    this.wasAlive = t.alive;
  }

  // Per-episode coverage is tracked as a simple counter of first-time
  // visits within the episode (a voxel revisited across episodes still
  // counts toward the episode's own progress).
  private episodeSeen = new Set<number>();
  private countEpisodeApprox(id: number): number {
    if (this.currentEpisodeForSet !== this.currentEpisode) {
      this.episodeSeen = new Set();
      this.currentEpisodeForSet = this.currentEpisode;
    }
    this.episodeSeen.add(id);
    return this.episodeSeen.size;
  }
  private currentEpisodeForSet = 0;

  // Voxel ids discovered since the last call (consumed by the map view).
  drainNewVoxels(): number[] {
    const out = this.newlyVisited;
    this.newlyVisited = [];
    return out;
  }

  stats(): CoverageStats {
    return {
      episode: this.currentEpisode,
      deaths: this.deaths.length,
      visitedVoxels: this.visitedCount,
      reachableVoxels: this.reachableVoxels,
      coverage: this.visitedCount / this.reachableVoxels,
      episodeVisited: this.episodeVisitedCount,
      episodeCoverage: this.episodeVisitedCount / this.reachableVoxels,
    };
  }
}
