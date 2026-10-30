use super::*;

/// A Close the client sent, or its echo of the server's, excuses a failed write to the socket
/// but not a failed read from disk, which stays the session's error.
#[test]
fn only_a_failure_on_the_socket_is_the_clients_close() {
    let write = anyhow::Error::new(tungstenite::Error::ConnectionClosed).context("write frame");
    let read = anyhow::anyhow!("io_uring read hit EOF").context("read frame 1");
    assert!(on_the_socket(&write), "a write to a closed socket was not the client's close");
    assert!(!on_the_socket(&read), "a failed read from disk was taken for the client's close");
}

/// Every accepted socket probes a silent peer on `KEEPALIVE`'s schedule, with Nagle off.
#[tokio::test]
async fn an_accepted_socket_probes_a_silent_peer() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let _client = TcpStream::connect(listener.local_addr().expect("addr")).await.expect("connect");
    let tcp = accept(&listener).await.expect("accept");
    let socket = SockRef::from(&tcp);
    assert!(socket.keepalive().expect("SO_KEEPALIVE"), "keep-alive is off");
    assert_eq!(socket.tcp_keepalive_time().expect("TCP_KEEPIDLE"), Duration::from_secs(20));
    assert_eq!(socket.tcp_keepalive_interval().expect("TCP_KEEPINTVL"), Duration::from_secs(5));
    assert_eq!(socket.tcp_keepalive_retries().expect("TCP_KEEPCNT"), 4);
    assert!(tcp.nodelay().expect("TCP_NODELAY"), "Nagle is on");
}
