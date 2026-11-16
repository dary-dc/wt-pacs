// SESSION's safety report leaves the decoder for its parent, the downloader, which owns the session: report-plan.md §3.3.
export const forward = (toParent) => (_url, body) => (toParent({ kind: "report", body }), Promise.resolve(true));
