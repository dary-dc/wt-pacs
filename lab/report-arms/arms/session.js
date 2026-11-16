// SESSION behind the seam: lab/report-arms/session/; its downloader writes every record on the series' session.
export { default, schedule } from "../session/session.js";
export const worker = "/lab/report-arms/session/decoder.js";
export const downloader = "/lab/report-arms/session/downloader.js";
