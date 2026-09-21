// Box geometry as non-indexed triangles: 9 floats per vertex
// (position xyz, normal xyz, color rgb).

export type RGB = [number, number, number];

export interface FaceColors {
  px: RGB; nx: RGB;
  py: RGB; ny: RGB;
  pz: RGB; nz: RGB;
}

export const FLOATS_PER_VERT = 9;

// inside=true flips winding + normals so the box is visible from within
// (used for the room shell).
export function makeBox(w: number, h: number, d: number, faceColors: FaceColors, inside = false): Float32Array {
  const x = w / 2, y = h / 2, z = d / 2;
  const faces: Array<{ n: RGB; c: RGB; v: [number, number, number][] }> = [
    { n: [ 1, 0, 0], c: faceColors.px, v: [[ x,-y,-z],[ x, y,-z],[ x, y, z],[ x,-y, z]] },
    { n: [-1, 0, 0], c: faceColors.nx, v: [[-x,-y, z],[-x, y, z],[-x, y,-z],[-x,-y,-z]] },
    { n: [ 0, 1, 0], c: faceColors.py, v: [[-x, y,-z],[-x, y, z],[ x, y, z],[ x, y,-z]] },
    { n: [ 0,-1, 0], c: faceColors.ny, v: [[-x,-y, z],[-x,-y,-z],[ x,-y,-z],[ x,-y, z]] },
    { n: [ 0, 0, 1], c: faceColors.pz, v: [[-x,-y, z],[ x,-y, z],[ x, y, z],[-x, y, z]] },
    { n: [ 0, 0,-1], c: faceColors.nz, v: [[ x,-y,-z],[-x,-y,-z],[-x, y,-z],[ x, y,-z]] },
  ];
  const data: number[] = [];
  for (const f of faces) {
    const n = inside ? [-f.n[0], -f.n[1], -f.n[2]] : f.n;
    const idx = inside ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      data.push(f.v[i][0], f.v[i][1], f.v[i][2], n[0], n[1], n[2], f.c[0], f.c[1], f.c[2]);
    }
  }
  return new Float32Array(data);
}

export function hex(c: number): RGB {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

export function solid(c: number): FaceColors {
  const rgb = hex(c);
  return { px: rgb, nx: rgb, py: rgb, ny: rgb, pz: rgb, nz: rgb };
}
