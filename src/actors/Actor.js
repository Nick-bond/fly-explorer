// Base class for anything that lives in the room and updates every frame.
//
// Lifecycle:
//   spawn(renderer, room)  — called once when added to the app: create the
//                            actor's mesh(es) and initial node(s) here.
//   update(dt, ctx)        — called every frame before rendering.
//                            ctx = { room, camera, input } so an actor can
//                            react to the room bounds, the viewer, or input.
//
// An actor exposes its renderable state through `nodes`: an array of
// { mesh, model, rotation, grid? } that the renderer draws as-is.
// Update `model`/`rotation` in update() to move the actor.
export class Actor {
  constructor() {
    this.nodes = [];
  }

  // eslint-disable-next-line no-unused-vars
  spawn(renderer, room) {}

  // eslint-disable-next-line no-unused-vars
  update(dt, ctx) {}
}
