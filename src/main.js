import { Renderer } from './room-ui/Renderer.js';
import { Room } from './room-ui/Room.js';
import { Camera } from './room-ui/Camera.js';
import { Input } from './room-ui/Input.js';
import { Fly } from './actors/Fly.js';

class App {
  constructor(canvas) {
    this.renderer = new Renderer(canvas);
    this.room = new Room(this.renderer);
    this.camera = new Camera();
    this.input = new Input(canvas);
    this.actors = [];
    this.afterFrame = null;
    this._prev = performance.now();
  }

  addActor(actor) {
    actor.spawn(this.renderer, this.room);
    this.actors.push(actor);
    return actor;
  }

  start() {
    requestAnimationFrame((t) => this._frame(t));
  }

  _frame(now) {
    const dt = Math.min((now - this._prev) / 1000, 0.1);
    this._prev = now;

    const ctx = { room: this.room, camera: this.camera, input: this.input };
    this.camera.update(dt, this.input, this.room);
    for (const actor of this.actors) actor.update(dt, ctx);

    const nodes = [...this.room.nodes];
    for (const actor of this.actors) nodes.push(...actor.nodes);
    this.renderer.render(this.camera, nodes);

    if (this.afterFrame) this.afterFrame();
    requestAnimationFrame((t) => this._frame(t));
  }
}

// Copy one eye's RGBA buffer onto a debug canvas (WebGL rows are
// bottom-up, so flip vertically).
function blitEye(canvas2d, pixels, res) {
  const ctx2 = canvas2d.getContext('2d');
  const img = ctx2.createImageData(res, res);
  for (let y = 0; y < res; y++) {
    img.data.set(pixels.subarray((res - 1 - y) * res * 4, (res - y) * res * 4), y * res * 4);
  }
  ctx2.putImageData(img, 0, 0);
}

const canvas = document.getElementById('scene');
try {
  const app = new App(canvas);
  // No controller yet: the fly hovers at its start position until the
  // neural network is plugged in as its controller.
  const fly = app.addActor(new Fly());

  // Dev-only preview of what the fly sees. The brain gets only these
  // eye buffers, never the spectator camera.
  const eyeL = document.getElementById('eye-left');
  const eyeR = document.getElementById('eye-right');
  eyeL.width = eyeL.height = fly.eyes.resolution;
  eyeR.width = eyeR.height = fly.eyes.resolution;
  app.afterFrame = () => {
    blitEye(eyeL, fly.eyes.leftPixels, fly.eyes.resolution);
    blitEye(eyeR, fly.eyes.rightPixels, fly.eyes.resolution);
  };

  app.start();
  window.app = app; // handy for poking at it from the console
} catch (err) {
  document.querySelector('.hud').insertAdjacentHTML(
    'beforeend',
    '<div class="panel"><p class="hint">Could not start WebGL: ' + err.message + '</p></div>'
  );
  throw err;
}
