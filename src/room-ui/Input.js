// Keyboard + pointer input, decoupled from what consumes it.
// The camera (or later a player actor) reads:
//   input.moveAxis()     -> { forward, strafe, vertical } each in -1..1
//   input.consumeLook()  -> { dx, dy } pointer-drag pixels since last call
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this._lookDX = 0;
    this._lookDY = 0;
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      canvas.classList.add('dragging');
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      this._lookDX += e.clientX - this._lastX;
      this._lookDY += e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      this._dragging = false;
      canvas.classList.remove('dragging');
      canvas.releasePointerCapture(e.pointerId);
    });
  }

  _pressed(...names) {
    return names.some((n) => this.keys.has(n));
  }

  moveAxis() {
    let forward = 0, strafe = 0, vertical = 0;
    if (this._pressed('w', 'arrowup')) forward += 1;
    if (this._pressed('s', 'arrowdown')) forward -= 1;
    if (this._pressed('d', 'arrowright')) strafe += 1;
    if (this._pressed('a', 'arrowleft')) strafe -= 1;
    if (this._pressed('e')) vertical += 1;
    if (this._pressed('q')) vertical -= 1;
    return { forward, strafe, vertical };
  }

  consumeLook() {
    const look = { dx: this._lookDX, dy: this._lookDY };
    this._lookDX = 0;
    this._lookDY = 0;
    return look;
  }
}
