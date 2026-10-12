// The product's AV1 module with fault.js around its decode.
import * as real from "/client/decode/av1.js";
import { inject } from "./fault.js";

export const { init } = real;
export const decodeFrame = inject(real.decodeFrame);
