/** The slice slider along the canvas's right edge: a finger steps or jumps through the slices. client/README.md §The viewer */

/** The keys a focused range answers itself, which the page must skip so that each steps once. */
export const RANGE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

/** `el` spans `n` slices; moving it pauses cine and shows its slice. Returns `follow(i)`, which moves it to a slice shown otherwise. */
export function sliceSlider(el, n, { show, pause }) {
  el.max = String(n - 1);
  el.oninput = () => {
    pause();
    show(Number(el.value));
  };
  return (i) => (el.value = String(i));
}
