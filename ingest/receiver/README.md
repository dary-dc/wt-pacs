# pacs-receiver

The PACS's receiver: one package from `incoming/` to the serving tree, stored or refused. What it does and why each step
exists: [`docs/adr/pacs-receiver.md`](../../docs/adr/pacs-receiver.md). Behind no deployment: nothing runs it on a
schedule, and no carrier writes its `incoming/` yet.

```bash
cargo run -p pacs-receiver -- <root> <incoming>   # recover, take every package once, print each status
cargo test -p pacs-receiver                       # every step, refusal and crash point
```

`<root>` and `<incoming>` must be one filesystem. The receiver creates `incoming/status/`, `incoming/refused/` and
`incoming/quarantine/`, and holds `incoming/.lock` while it runs.

## Tests

`src/test/receive.rs` holds a test per step and per refusal; `src/test/crash.rs` kills a child process (the test binary
itself, re-run on `crash_child`) after each of the eight points between steps, in three cases, and restarts. The read-back
tests read `/proc/thread-self/io` and so need Linux; the `EXDEV` test needs `/dev/shm` on another filesystem than the
build, and prints `SKIPPED` without it.

## Mutations

Each check and step was broken on purpose, one at a time, and the whole suite run (2026-10-26); every one failed a test.
A mutation is the named check removed or inverted unless the row says otherwise.

| file | broken | failed |
| --- | --- | --- |
| `disk.rs` | drop_cache does not drop | `the_read_back_reads_from_the_device_not_the_cache, the_study_db_is_verified_from_the_device` |
| `disk.rs` | read_from_disk reads the cache | `the_read_back_reads_from_the_device_not_the_cache` |
| `disk.rs` | hash_file(from_disk) reads the cache | `the_read_back_reads_from_the_device_not_the_cache` |
| `disk.rs` | file hash skips bytes | 25 tests, among them `the_file_hash_is_xxh3_of_every_byte` |
| `disk.rs` | status write leaves its partial | `a_durable_write_leaves_the_file_and_no_partial, a_series_package_is_placed_recorded_confirmed_and_deleted` |
| `group.rs` | a key not a multiple of 8 accepted | `a_cut_group_is_refused` |
| `group.rs` | a cut record header accepted | `a_cut_group_is_refused` |
| `group.rs` | a cut value accepted | `a_cut_group_is_refused` |
| `group.rs` | a nested record read as top level | `a_value_is_read_at_the_top_level_only` |
| `group.rs` | Number of Frames 0 is 0 | `number_of_frames_absent_or_zero_is_one` |
| `group.rs` | UID coding, remainder of two | `a_uid_codes_as_the_contract_writes_it` |
| `package.rs` | name: unit not coded accepted | `a_name_outside_the_grammar_is_refused` |
| `package.rs` | revision with a leading zero | `a_name_outside_the_grammar_is_refused` |
| `package.rs` | name: hash not lowercase hex | `a_name_outside_the_grammar_is_refused` |
| `package.rs` | header: line count | `a_header_the_name_or_layout_disagrees_with_is_refused` |
| `package.rs` | header: layout | `a_header_the_name_or_layout_disagrees_with_is_refused` |
| `package.rs` | header: study/unit not coded | `a_header_the_name_or_layout_disagrees_with_is_refused` |
| `package.rs` | header not the first member | `a_header_the_name_or_layout_disagrees_with_is_refused` |
| `package.rs` | header size | `a_header_the_name_or_layout_disagrees_with_is_refused` |
| `package.rs` | member outside the study | `a_member_outside_the_layout_is_refused` |
| `package.rs` | member directory not coded | `a_member_outside_the_layout_is_refused` |
| `package.rs` | non-regular member | `a_member_outside_the_layout_is_refused` |
| `package.rs` | member twice | `a_member_outside_the_layout_is_refused` |
| `package.rs` | second bundle | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | group size before reading | `a_group_past_the_limit_is_refused_unread` |
| `package.rs` | group hash vs name | `a_group_not_hashing_to_its_name_is_refused` |
| `package.rs` | zstd not detected | `a_zstd_bomb_is_refused, a_zstd_compressed_group_is_stored_as_the_group` |
| `package.rs` | zstd bomb | `a_zstd_bomb_is_refused` |
| `package.rs` | group UID vs path | `a_group_holding_another_uid_than_its_path_is_refused, a_name_outside_the_grammar_is_refused` |
| `package.rs` | group outside the unit | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | exam group in a series update | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | private group without instance | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | one exam and one series group | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | series package without instances | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | bundle of another series | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | update with a bundle | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | update with no group | `a_package_missing_what_its_kind_needs_is_refused` |
| `package.rs` | staged hash skips bytes | 16 tests, among them `a_bundle_not_matching_its_instances_or_not_v1_is_refused` |
| `study_db.rs` | a recorded package recorded again | 3 tests, among them `a_crash_between_any_two_steps_leaves_the_serving_tree_whole` |
| `study_db.rs` | update without a current row | `an_update_to_nothing_stored_is_refused` |
| `study_db.rs` | series revision keeps old instances | 5 tests, among them `a_crash_between_any_two_steps_leaves_the_serving_tree_whole` |
| `study_db.rs` | row moved between series | `an_update_to_nothing_stored_is_refused` |
| `study_db.rs` | audit lists unchanged rows | `a_series_revision_replaces_the_series_whole` |
| `study_db.rs` | verify reads the cache | `the_study_db_is_verified_from_the_device` |
| `study_db.rs` | integrity_check ignored | `a_study_db_failing_its_integrity_check_is_refused` |
| `study_db.rs` | row hash read-back ignored | `a_failed_read_back_of_a_resend_keeps_the_stored_rows, a_study_db_reading_back_wrong_is_undone` |
| `study_db.rs` | removed row read-back ignored | `a_study_db_reading_back_wrong_is_undone` |
| `study_db.rs` | restore undoes a resend | `a_failed_read_back_of_a_resend_keeps_the_stored_rows` |
| `study_db.rs` | restore keeps written rows | `a_study_db_reading_back_wrong_is_undone` |
| `study_db.rs` | restore keeps the audit record | `a_study_db_reading_back_wrong_is_undone` |
| `study_db.rs` | study DB pages not dropped | `the_study_db_is_verified_from_the_device` |
| `lib.rs` | two filesystems accepted | `incoming_on_another_filesystem_is_refused` |
| `lib.rs` | no lock | `a_second_receiver_on_one_incoming_is_refused` |
| `lib.rs` | recovery keeps work dirs | `a_crash_between_any_two_steps_leaves_the_serving_tree_whole` |
| `lib.rs` | recovery keeps partial statuses | `a_restart_removes_work_directories_and_takes_what_is_left` |
| `lib.rs` | a partial arrival picked up | `a_partial_arrival_is_not_picked_up` |
| `lib.rs` | updates not first | `an_update_is_taken_before_series_packages` |
| `lib.rs` | work dir left after a package | `a_crash_between_any_two_steps_leaves_the_serving_tree_whole, a_series_package_is_placed_recorded_confirmed_and_deleted` |
| `lib.rs` | derive not called | `derive_then_index_are_told_what_was_stored` |
| `lib.rs` | second refusal not quarantined | `the_same_content_refused_twice_is_quarantined` |
| `lib.rs` | status not written | 4 tests, among them `a_crash_between_any_two_steps_leaves_the_serving_tree_whole` |
| `lib.rs` | refused copy kept after store | `a_revision_out_of_order_is_refused_until_its_predecessor_is_stored, the_same_content_refused_twice_is_quarantined` |
| `lib.rs` | package hash vs name | `a_package_not_hashing_to_its_name_is_refused_and_kept` |
| `lib.rs` | header vs name | `a_header_the_name_or_layout_disagrees_with_is_refused` |
| `lib.rs` | update to a study not stored | `an_update_to_nothing_stored_is_refused` |
| `lib.rs` | conflict not quarantined | `another_package_for_a_stored_revision_is_quarantined` |
| `lib.rs` | old revision staged again | `a_resend_of_a_stored_revision_is_stored_without_change` |
| `lib.rs` | revision gap accepted | `a_revision_out_of_order_is_refused_until_its_predecessor_is_stored` |
| `lib.rs` | group read-back ignored | `a_staged_file_changed_after_its_write_is_refused_by_the_read_back` |
| `lib.rs` | pixels placed after metadata (with line 321) | `a_crash_between_any_two_steps_leaves_the_serving_tree_whole, a_study_db_reading_back_wrong_is_undone` |
| `lib.rs` | restore not called | `a_study_db_reading_back_wrong_is_undone` |
| `lib.rs` | replaced bundle not kept | `a_study_db_reading_back_wrong_is_undone` |
| `lib.rs` | new study not removed on R | `a_study_db_reading_back_wrong_is_undone` |
| `lib.rs` | bundle read-back hash ignored | `a_staged_file_changed_after_its_write_is_refused_by_the_read_back` |
| `lib.rs` | frameCount vs index | `a_bundle_not_matching_its_instances_or_not_v1_is_refused` |
| `lib.rs` | unknown codec accepted | `a_bundle_not_matching_its_instances_or_not_v1_is_refused` |
| `lib.rs` | frames vs instance groups | `a_bundle_not_matching_its_instances_or_not_v1_is_refused` |

Not mutation-tested, because no test here can observe it: that the `fsync`s make a placement survive a power cut.
