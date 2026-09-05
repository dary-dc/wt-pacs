# Proposal: what `server_work_us` should mean — superseded

**Status:** **superseded.** Stages are now `prepare_us` / `locate_us` / `send_us` / `serve_us` /
`overhead_us` under `schema: server-pipeline-v1`. See
[`telemetry/adr-server-pipeline.md`](telemetry/adr-server-pipeline.md) and
[`telemetry/README.md`](telemetry/README.md).

Prefault lives in `ProductPipeline::prepare`. Do not revive `server_work_us` naming from this draft.
