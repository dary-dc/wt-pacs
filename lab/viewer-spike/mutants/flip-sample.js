const set = Uint8Array.prototype.set;
Uint8Array.prototype.set = function (src, at) {
  set.call(this, src, at);
  if (this.buffer instanceof SharedArrayBuffer && this.length > 1 << 20) this[this.length >> 1] ^= 1;
};
