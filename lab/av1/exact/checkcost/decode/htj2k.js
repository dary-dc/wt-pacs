// The product's HTJ2K module with fault.js around its decode.
import * as real from "/client/decode/htj2k.js";
import { inject } from "./fault.js";

export const { finish, unranged, init } = real;
export const decodeFrame = inject(real.decodeFrame);
