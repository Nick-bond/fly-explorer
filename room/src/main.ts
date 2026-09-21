import { Renderer } from './render/Renderer';
import { Environment } from './env/Environment';
import { BrainLink } from './link/BrainLink';
import { Mapper } from './observer/Mapper';
import { MapLayer } from './observer/MapLayer';
import { Camera } from './ui/Camera';
import { Input } from './ui/Input';
import type { LinkStatus } from './link/BrainLink';

// Copy one eye's RGBA buffer onto a debug canvas (WebGL rows are
// bottom-up, so flip vertically).
function blitEye(canvas2d: HTMLCanvasElement, pixels: Uint8Array, res: number): void {
  const ctx2 = canvas2d.getContext('2d');
  if (!ctx2) return;
  const img = ctx2.createImageData(res, res);
  for (let y = 0; y < res; y++) {
    img.data.set(pixels.subarray((res - 1 - y) * res * 4, (res - y) * res * 4), y * res * 4);
  }
  ctx2.putImageData(img, 0, 0);
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>('scene');
try {
  const renderer = new Renderer(canvas);
  const env = new Environment(renderer);
  const camera = new Camera();
  const input = new Input(canvas);
  const brain = new BrainLink();

  // Observer/mapper: builds the 3D exploration map + death stats from
  // privileged telemetry. One-way — nothing flows back to the brain.
  const mapper = new Mapper(env.room);
  const mapLayer = new MapLayer(renderer, mapper);
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') mapLayer.visible = !mapLayer.visible;
  });

  // Dev-only preview of what the fly sees. The brain gets only the eye
  // buffers, never this page's spectator camera.
  const eyeL = el<HTMLCanvasElement>('eye-left');
  const eyeR = el<HTMLCanvasElement>('eye-right');
  eyeL.width = eyeL.height = env.eyes.resolution;
  eyeR.width = eyeR.height = env.eyes.resolution;

  const brainStatus = el<HTMLSpanElement>('brain-status');
  const showStatus = (status: LinkStatus) => {
    brainStatus.textContent = status;
    brainStatus.dataset.status = status;
  };
  brain.onStatusChange = showStatus;
  showStatus(brain.status);

  const statsEl = el<HTMLParagraphElement>('map-stats');
  let lastStatsUpdate = 0;
  const updateStats = (now: number) => {
    if (now - lastStatsUpdate < 250) return;
    lastStatsUpdate = now;
    const s = mapper.stats();
    statsEl.textContent =
      `episode ${s.episode} · deaths ${s.deaths} · ` +
      `explored ${(s.coverage * 100).toFixed(1)}% (this run ${(s.episodeCoverage * 100).toFixed(1)}%)`;
  };

  let prev = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min((now - prev) / 1000, 0.1);
    prev = now;

    if (brain.consumeResetRequest()) env.reset();
    // The fly acts only on the brain's latest command (zeros when no
    // brain is connected — it hovers).
    const observation = env.step(brain.latestAction, dt);
    brain.sendObservation(observation);
    mapper.update(observation);
    mapLayer.sync();
    updateStats(now);

    camera.update(dt, input, env.room);
    renderer.render(camera, [...env.sceneNodes, ...mapLayer.nodes]);

    blitEye(eyeL, env.eyes.leftPixels, env.eyes.resolution);
    blitEye(eyeR, env.eyes.rightPixels, env.eyes.resolution);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Handy for poking at it from the console.
  (window as unknown as Record<string, unknown>).flyexplorer = { env, camera, brain, mapper };
} catch (err) {
  document.querySelector('.hud')?.insertAdjacentHTML(
    'beforeend',
    `<div class="panel"><p class="hint">Could not start WebGL: ${(err as Error).message}</p></div>`,
  );
  throw err;
}
