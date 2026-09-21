// Keyboard + pointer input for the spectator camera, decoupled from what
// consumes it:
//   input.moveAxis()     -> { forward, strafe, vertical } each in -1..1
//   input.consumeLook()  -> { dx, dy } pointer-drag pixels since last call
export class Input {
  private readonly keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.classList.add('dragging');
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.lookDX += e.clientX - this.lastX;
      this.lookDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      this.dragging = false;
      canvas.classList.remove('dragging');
      canvas.releasePointerCapture(e.pointerId);
    });
  }

  private pressed(...names: string[]): boolean {
    return names.some((n) => this.keys.has(n));
  }

  moveAxis(): { forward: number; strafe: number; vertical: number } {
    let forward = 0, strafe = 0, vertical = 0;
    if (this.pressed('w', 'arrowup')) forward += 1;
    if (this.pressed('s', 'arrowdown')) forward -= 1;
    if (this.pressed('d', 'arrowright')) strafe += 1;
    if (this.pressed('a', 'arrowleft')) strafe -= 1;
    if (this.pressed('e')) vertical += 1;
    if (this.pressed('q')) vertical -= 1;
    return { forward, strafe, vertical };
  }

  consumeLook(): { dx: number; dy: number } {
    const look = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return look;
  }
}
