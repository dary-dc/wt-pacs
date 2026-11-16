// SESSION's floor (report-plan.md §7.2): a bare bidirectional stream with the arm's own bytes and the server's byte,
// under a fresh load id and reportId of the same lengths (KEEPALIVE's floor, with the stream for the fetch).
import { floor as same } from "../keepalive/floor.js";
import { write } from "./report.js";

export const floor = ({ wt, load, body }) => same({ base: "", load, body, send: (_url, bytes) => write(wt, bytes) });
