use super::*;

/// The banner's URLs name the address `--bind` gives when it is a specific one, in URL form for
/// IPv6, and loopback when `--bind` is absent or a wildcard.
#[test]
fn the_url_names_a_specific_bind_address_and_loopback_otherwise() {
    let host = |bind: Option<&str>| url_host(bind.map(|ip| ip.parse().unwrap()), 4433).to_string();
    assert_eq!(host(Some("10.77.0.2")), "10.77.0.2:4433");
    assert_eq!(host(Some("::1")), "[::1]:4433");
    assert_eq!(host(Some("127.0.0.1")), "127.0.0.1:4433");
    assert_eq!(host(None), "127.0.0.1:4433");
    assert_eq!(host(Some("0.0.0.0")), "127.0.0.1:4433");
    assert_eq!(host(Some("::")), "127.0.0.1:4433");
}
