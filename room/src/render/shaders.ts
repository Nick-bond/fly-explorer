export const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uModel;
uniform mat4 uRotation;
uniform mat4 uViewProj;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = (uRotation * vec4(aNormal, 0.0)).xyz;
  vColor = aColor;
  gl_Position = uViewProj * world;
}`;

// Fixed lighting: ambient + one static ceiling light. No shadows,
// reflections, animated lights or textures.
export const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
uniform vec3 uLightPos;
uniform float uGrid;
uniform float uAlpha;
void main() {
  vec3 n = normalize(vNormal);
  vec3 toLight = uLightPos - vWorld;
  float dist = length(toLight);
  float diff = max(dot(n, toLight / dist), 0.0);
  float atten = 1.0 / (1.0 + 0.06 * dist * dist);
  vec3 col = vColor * (0.45 + 0.75 * diff * atten);
  // 1 m grid lines on the floor (spectator view only; eye renders disable it)
  if (uGrid > 0.5 && n.y > 0.9 && vWorld.y < 0.01) {
    vec2 g = abs(fract(vWorld.xz + 0.5) - 0.5);
    float line = smoothstep(0.025, 0.0, min(g.x, g.y));
    col *= 1.0 - 0.18 * line;
  }
  gl_FragColor = vec4(col, uAlpha);
}`;
