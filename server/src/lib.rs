pub mod media;
pub mod transport;

pub use transport::server::{run_server, ServeConfig};

// history-note: feat(server): Media-complete exact server on dedicated port

// history-note: perf(server): share one FrameStore and send HTJ2K from mmap 

// history-note: feat(server): Media-complete session accept loop
