use super::*;

#[test]
fn fod_len_zero_and_huge_are_refused_before_allocation() {
    assert!(check_fod_len(0).is_err());
    assert!(check_fod_len(1).is_ok());
    assert!(check_fod_len(MAX_FOD_LEN).is_ok());
    assert!(check_fod_len(MAX_FOD_LEN + 1).is_err());
    assert!(
        check_fod_len(u32::MAX as usize).is_err(),
        "a 4 GB length prefix is refused"
    );
}

/// The longest message a client sends, a fill with both ends at `u32::MAX`, fits under the cap.
#[test]
fn the_longest_client_message_fits() {
    let longest = FodMsg::StreamFrames { from: Some(u32::MAX), to: Some(u32::MAX) };
    let bytes = encode_fod_msg(&longest).unwrap();
    check_fod_len(bytes.len() - 4).unwrap();
    assert_eq!(decode_fod_body(&bytes[4..]).unwrap(), longest);
}
