//! Many series under one root, each named by its study's and its own coded UID, each open only
//! while a session reads it. `docs/adr/serving-by-uid.md`.

use crate::media::frame_store::FrameStore;
use std::collections::HashMap;
use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};

#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

/// Two characters per three of a 64-character UID, rounded up: `docs/ingest/contract.md` §The layout.
const MAX_CODED_UID: usize = 44;

/// A study and a series, each a coded UID, so neither can name a file outside its folder.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SeriesName {
    study: String,
    series: String,
}

impl SeriesName {
    /// `/<Study>/<Series>`, the query already cut off.
    pub fn parse(path: &str) -> Option<Self> {
        let (study, series) = path.strip_prefix('/')?.split_once('/')?;
        (coded_uid(study) && coded_uid(series)).then(|| Self { study: study.into(), series: series.into() })
    }
}

fn coded_uid(segment: &str) -> bool {
    let coded = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'~';
    let len = segment.len();
    (2..=MAX_CODED_UID).contains(&len) && len % 2 == 0 && segment.bytes().all(coded)
}

/// Where a series lives under `--root`; the layout is this function alone. `docs/adr/serving-by-uid.md` §2
pub fn series_path(root: &Path, name: &SeriesName) -> PathBuf {
    root.join(&name.study).join(format!("{}.sbnd", name.series))
}

/// Why a session was closed before its first frame: the code and reason of `docs/WIRE.md` §Refusing a series.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeriesRefusal {
    BadName = 1,
    NotFound = 2,
    Changed = 3,
    Unreadable = 4,
    Busy = 5,
}

impl SeriesRefusal {
    pub fn code(self) -> u32 {
        self as u32
    }

    pub fn reason(self) -> &'static str {
        match self {
            SeriesRefusal::BadName => "bad series name",
            SeriesRefusal::NotFound => "series not found",
            SeriesRefusal::Changed => "series changed",
            SeriesRefusal::Unreadable => "series unreadable",
            SeriesRefusal::Busy => "server busy",
        }
    }

    /// The operator's to fix, not the client's.
    pub fn is_the_servers(self) -> bool {
        matches!(self, SeriesRefusal::Unreadable | SeriesRefusal::Busy)
    }

    fn of_io(err: &io::Error) -> Self {
        match err.raw_os_error() {
            Some(libc::ENOENT | libc::ENOTDIR) => SeriesRefusal::NotFound,
            Some(libc::EMFILE | libc::ENFILE | libc::ENOMEM) => SeriesRefusal::Busy,
            _ => SeriesRefusal::Unreadable,
        }
    }

    /// A bundle that opened and failed its checks is unreadable whatever else the error says.
    fn of_open(err: &anyhow::Error) -> Self {
        err.chain().find_map(|e| e.downcast_ref::<io::Error>()).map_or(SeriesRefusal::Unreadable, Self::of_io)
    }
}

/// `(st_dev, st_ino)`: a rename over the name gives it another.
type FileId = (u64, u64);

struct Held {
    store: Weak<FrameStore>,
    file: FileId,
}

pub struct SeriesTree {
    root: PathBuf,
    open: Mutex<HashMap<SeriesName, Held>>,
    #[cfg(test)]
    opens: AtomicUsize,
    #[cfg(test)]
    failing_opens: Mutex<Option<i32>>,
    #[cfg(test)]
    open_delay: Mutex<std::time::Duration>,
}

impl SeriesTree {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            open: Mutex::new(HashMap::new()),
            #[cfg(test)]
            opens: AtomicUsize::new(0),
            #[cfg(test)]
            failing_opens: Mutex::new(None),
            #[cfg(test)]
            open_delay: Mutex::new(std::time::Duration::ZERO),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The store a new session on `name` reads. Blocks: call from the blocking pool.
    pub fn find(&self, name: &SeriesName, digest: Option<&str>) -> Result<Arc<FrameStore>, SeriesRefusal> {
        let path = series_path(&self.root, name);
        let store = self.current(name, &path)?;
        if pairs(&store, digest) {
            return Ok(store);
        }
        let (store, file) = self.open(&path)?;
        if !pairs(&store, digest) {
            return Err(SeriesRefusal::Changed);
        }
        Ok(self.keep(name, store, file))
    }

    fn current(&self, name: &SeriesName, path: &Path) -> Result<Arc<FrameStore>, SeriesRefusal> {
        let file = file_id(path)?;
        if let Some(store) = self.held(name, file) {
            return Ok(store);
        }
        let (store, file) = self.open(path)?;
        Ok(self.keep(name, store, file))
    }

    fn held(&self, name: &SeriesName, file: FileId) -> Option<Arc<FrameStore>> {
        let open = self.open.lock().unwrap();
        open.get(name).filter(|held| held.file == file).and_then(|held| held.store.upgrade())
    }

    /// Stats before it opens: a rename between the two costs a reopen at the next lookup, never a stale store.
    fn open(&self, path: &Path) -> Result<(Arc<FrameStore>, FileId), SeriesRefusal> {
        let file = file_id(path)?;
        #[cfg(test)]
        self.account_open()?;
        let store = FrameStore::open(path).map_err(|err| SeriesRefusal::of_open(&err))?;
        Ok((Arc::new(store), file))
    }

    /// Keeps a live store of the same file another session opened meanwhile, so racing opens converge.
    fn keep(&self, name: &SeriesName, store: Arc<FrameStore>, file: FileId) -> Arc<FrameStore> {
        let mut open = self.open.lock().unwrap();
        if let Some(held) = open.get(name).filter(|held| held.file == file).and_then(|held| held.store.upgrade()) {
            return held;
        }
        open.retain(|_, held| held.store.strong_count() > 0);
        open.insert(name.clone(), Held { store: Arc::downgrade(&store), file });
        store
    }

    #[cfg(test)]
    fn account_open(&self) -> Result<(), SeriesRefusal> {
        self.opens.fetch_add(1, Ordering::Relaxed);
        std::thread::sleep(*self.open_delay.lock().unwrap());
        match *self.failing_opens.lock().unwrap() {
            Some(errno) => Err(SeriesRefusal::of_io(&io::Error::from_raw_os_error(errno))),
            None => Ok(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn opens(&self) -> usize {
        self.opens.load(Ordering::Relaxed)
    }

    /// Every open from now fails as `open(2)` would with `errno`.
    #[cfg(test)]
    pub(crate) fn fail_opens(&self, errno: Option<i32>) {
        *self.failing_opens.lock().unwrap() = errno;
    }

    #[cfg(test)]
    pub(crate) fn delay_opens(&self, by: std::time::Duration) {
        *self.open_delay.lock().unwrap() = by;
    }

    #[cfg(test)]
    pub(crate) fn held_series(&self) -> usize {
        self.open.lock().unwrap().values().filter(|held| held.store.strong_count() > 0).count()
    }
}

/// A v1 bundle carries no digest, so a digest asked of it is a mismatch. `docs/adr/serving-by-uid.md` §5
fn pairs(_store: &FrameStore, digest: Option<&str>) -> bool {
    digest.is_none()
}

fn file_id(path: &Path) -> Result<FileId, SeriesRefusal> {
    let meta = std::fs::metadata(path).map_err(|err| SeriesRefusal::of_io(&err))?;
    Ok((meta.dev(), meta.ino()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALPHABET: &[u8; 64] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

    /// `docs/ingest/contract.md` §The layout, its coding, for UIDs: digits and `.`, padded with NUL to even.
    fn code(uid: &str) -> String {
        let mut uid = uid.to_string();
        if uid.len() % 2 == 1 {
            uid.push('\0');
        }
        let nibble = |c: char| match c {
            '\0' => 0,
            '.' => 5,
            d => 6 + d.to_digit(10).expect("a UID is digits and dots") as usize,
        };
        let n: Vec<usize> = uid.chars().map(nibble).collect();
        let mut out = String::new();
        for group in n.chunks(3) {
            let (a, b) = match *group {
                [n0, n1, n2] => ((n0 << 2) + (n1 >> 2), ((n1 & 3) << 4) + n2),
                [n0, n1] => ((n0 << 2) + (n1 >> 2), (n1 & 3) << 4),
                [n0] => (n0 << 2, 0),
                _ => unreachable!(),
            };
            out.push(ALPHABET[a] as char);
            out.push(ALPHABET[b] as char);
        }
        out
    }

    struct Tree {
        dir: PathBuf,
        tree: SeriesTree,
    }

    impl Tree {
        fn new() -> Self {
            static N: AtomicUsize = AtomicUsize::new(0);
            let n = N.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("wtpacs-tree-{}-{n}", std::process::id()));
            std::fs::create_dir_all(dir.join("root")).expect("tmpdir");
            let tree = SeriesTree::new(dir.join("root"));
            Self { dir, tree }
        }

        /// A one-frame series whose frame is `body`, published at `name` by rename, as the receiver does.
        fn publish(&self, name: &SeriesName, body: &[u8]) {
            let path = series_path(self.tree.root(), name);
            std::fs::create_dir_all(path.parent().unwrap()).expect("study dir");
            let partial = path.with_extension("sbnd.partial");
            series_bundle::write_bundle(&partial, b"{\"frameCount\":1}", &[body]).expect("write series");
            std::fs::rename(&partial, &path).expect("rename into place");
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.dir).ok();
        }
    }

    fn name(study: &str, series: &str) -> SeriesName {
        SeriesName::parse(&format!("/{}/{}", code(study), code(series))).expect("a coded name")
    }

    fn frame(store: &FrameStore) -> Vec<u8> {
        let span = store.frame_span(0);
        let mut buf = vec![0u8; span.len as usize];
        store.read_at_blocking(&mut buf, span.offset).expect("read frame");
        buf
    }

    /// The coding as `docs/ingest/contract.md` states it, checked on its own example.
    #[test]
    fn the_coding_in_these_tests_is_the_contracts() {
        assert_eq!(code("1.2.3"), "TOMG");
    }

    /// A segment is a coded UID: the coding's alphabet, an even length, and no longer than a
    /// 64-character UID codes to. Every traversal spelling and every PS3.5 UID with its dots fails.
    #[test]
    fn a_name_is_two_coded_uids_and_nothing_else() {
        let longest = code(&format!("1.{}", "2".repeat(62)));
        assert_eq!(longest.len(), MAX_CODED_UID, "a 64-character UID codes to the bound");
        for path in ["/TOMG/TOMG", "/00/~~", &format!("/{longest}/A_z~"), &format!("/{}/{}", code("1.2.840.10008"), code("0"))] {
            assert!(SeriesName::parse(path).is_some(), "{path} refused");
        }
        for path in [
            "/TOMG/..", "/../TOMG", "/./TOMG", "/TOMG/.", "/TOMG/1.2.3", "/TOMG/%2e%2e", "/TOMG/TO/MG",
            "/TOMG/TOM", "/TOMG/T", "/TOMG/", "//TOMG", "/TOMG", "/", "", "TOMG/TOMG", "/TOMG/TOMG/",
            "/TOMG/TO-G", "/TOMG/TO+G", "/TOMG/TO\0G", "/TOMG/ＴOMG", "/TOMG/١٢",
            &format!("/TOMG/{longest}00"),
        ] {
            assert!(SeriesName::parse(path).is_none(), "{path:?} accepted");
        }
    }

    /// The layout under `--root` is `<root>/<Study>/<Series>.sbnd`, and never a `.partial`.
    #[test]
    fn a_series_lives_at_its_study_folder_and_its_own_name() {
        let name = SeriesName::parse("/TOMG/A_z~").unwrap();
        assert_eq!(series_path(Path::new("/r"), &name), Path::new("/r/TOMG/A_z~.sbnd"));
    }

    /// A `.partial` beside the name is not the series: a session on it is refused "not found".
    #[test]
    fn a_partial_is_never_served() {
        let t = Tree::new();
        let n = name("1.2", "1.2.3");
        let path = series_path(t.tree.root(), &n);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        series_bundle::write_bundle(&path.with_extension("sbnd.partial"), b"{}", &[b"x"]).unwrap();
        assert_eq!(t.tree.find(&n, None).err(), Some(SeriesRefusal::NotFound));
        assert_eq!(t.tree.find(&name("9.9", "1.2.3"), None).err(), Some(SeriesRefusal::NotFound), "a missing study folder");
    }

    /// **One store per open series.** Sessions on one series share its store; another series has its own.
    #[test]
    fn sessions_on_one_series_share_its_store() {
        let t = Tree::new();
        let (a, b) = (name("1.2", "1.2.3"), name("1.2", "1.2.4"));
        t.publish(&a, b"a");
        t.publish(&b, b"b");
        let (first, second, other) = (t.tree.find(&a, None).unwrap(), t.tree.find(&a, None).unwrap(), t.tree.find(&b, None).unwrap());
        assert!(Arc::ptr_eq(&first, &second), "a second session on one series opened it again");
        assert!(!Arc::ptr_eq(&first, &other), "two series share a store");
        assert_eq!(t.tree.opens(), 2);
    }

    /// **The last session out closes the file.** The tree holds no store of its own.
    #[test]
    fn the_last_session_out_closes_the_file() {
        let t = Tree::new();
        let n = name("1.2", "1.2.3");
        t.publish(&n, b"a");
        let (one, two) = (t.tree.find(&n, None).unwrap(), t.tree.find(&n, None).unwrap());
        let watch = Arc::downgrade(&one);
        drop(one);
        assert!(watch.upgrade().is_some(), "closed under a session still reading it");
        drop(two);
        assert!(watch.upgrade().is_none(), "the store outlived its last session");
        assert_eq!(t.tree.held_series(), 0);
    }

    /// **A rename publishes to new sessions only.** A session open on the old file keeps reading
    /// it whole; the next session reads the file now at the name.
    #[test]
    fn a_renamed_in_series_reaches_new_sessions_only() {
        let t = Tree::new();
        let n = name("1.2", "1.2.3");
        t.publish(&n, b"old");
        let open = t.tree.find(&n, None).unwrap();
        t.publish(&n, b"new");
        let next = t.tree.find(&n, None).unwrap();
        assert_eq!(frame(&open), b"old", "the open session lost its file");
        assert_eq!(frame(&next), b"new", "a new session was handed the replaced file");
        assert_eq!(frame(&t.tree.find(&n, None).unwrap()), b"new");
    }

    /// A withdrawn series refuses new sessions "not found" and leaves open ones reading.
    #[test]
    fn a_withdrawn_series_refuses_new_sessions_only() {
        let t = Tree::new();
        let n = name("1.2", "1.2.3");
        t.publish(&n, b"kept");
        let open = t.tree.find(&n, None).unwrap();
        std::fs::remove_file(series_path(t.tree.root(), &n)).unwrap();
        assert_eq!(t.tree.find(&n, None).err(), Some(SeriesRefusal::NotFound));
        assert_eq!(frame(&open), b"kept");
    }

    /// **A digest pairs metadata and bundle.** A v1 bundle has none, so any digest is refused
    /// "changed", after exactly one reopen; no digest is served.
    #[test]
    fn a_digest_against_a_v1_bundle_is_refused_after_one_reopen() {
        let t = Tree::new();
        let n = name("1.2", "1.2.3");
        t.publish(&n, b"a");
        let open = t.tree.find(&n, None).unwrap();
        assert_eq!(t.tree.opens(), 1);
        assert_eq!(t.tree.find(&n, Some(&"ab".repeat(32))).err(), Some(SeriesRefusal::Changed));
        assert_eq!(t.tree.opens(), 2, "not exactly one reopen");
        assert!(Arc::ptr_eq(&open, &t.tree.find(&n, None).unwrap()), "the refused reopen displaced the held store");
    }

    /// A file at the name that reads whole and is not a bundle is refused "unreadable", not "not found".
    #[test]
    fn a_file_that_is_no_bundle_is_unreadable() {
        let t = Tree::new();
        let n = name("1.2", "1.2.3");
        let path = series_path(t.tree.root(), &n);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, [b'x'; 4096]).unwrap();
        assert_eq!(t.tree.find(&n, None).err(), Some(SeriesRefusal::Unreadable));
    }

    /// **Running out of descriptors refuses, never stops.** An open failing `EMFILE` or `ENFILE`
    /// is "server busy"; a series already open still serves.
    #[test]
    fn running_out_of_descriptors_is_busy_and_an_open_series_still_serves() {
        let t = Tree::new();
        let (held, cold) = (name("1.2", "1.2.3"), name("1.2", "1.2.4"));
        t.publish(&held, b"held");
        t.publish(&cold, b"cold");
        let open = t.tree.find(&held, None).unwrap();
        for errno in [libc::EMFILE, libc::ENFILE] {
            t.tree.fail_opens(Some(errno));
            assert_eq!(t.tree.find(&cold, None).err(), Some(SeriesRefusal::Busy), "errno {errno}");
        }
        assert!(Arc::ptr_eq(&open, &t.tree.find(&held, None).unwrap()));
        t.tree.fail_opens(None);
        assert_eq!(frame(&t.tree.find(&cold, None).unwrap()), b"cold", "busy stuck after the descriptors came back");
    }

    /// **Racing opens of one series converge.** 32 sessions on one cold series, all opening at
    /// once, all end on one store.
    #[test]
    fn racing_opens_of_one_series_converge() {
        let t = Tree::new();
        let n = name("1.2", "1.2.3");
        t.publish(&n, b"a");
        t.tree.delay_opens(std::time::Duration::from_millis(50));
        let stores: Vec<Arc<FrameStore>> = std::thread::scope(|s| {
            let racers: Vec<_> = (0..32).map(|_| s.spawn(|| t.tree.find(&n, None).unwrap())).collect();
            racers.into_iter().map(|r| r.join().unwrap()).collect()
        });
        assert!(t.tree.opens() > 1, "the opens did not race");
        assert!(stores.iter().all(|s| Arc::ptr_eq(s, &stores[0])), "racing sessions read through different stores");
        assert_eq!(t.tree.held_series(), 1);
    }
}
