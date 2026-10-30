/** A paint's settle that needs no other thread: client/paint/README.md §When a paint has executed */

const turn = () => new Promise((r) => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => (port1.close(), r());
  port2.postMessage(0);
});

/** Resolves once every command issued on `gl` before the call has executed; a sync's status changes only between tasks. */
export async function settled(gl) {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  do await turn();
  while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED);
  gl.deleteSync(sync);
}
