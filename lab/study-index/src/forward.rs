//! Two TUN devices joined with a fixed one-way delay: the emulated hop, since this kernel has no netem.

use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::FromRawFd;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const TUNSETIFF: libc::c_ulong = 0x4004_54CA;
const IFF_TUN: libc::c_short = 0x0001;
const IFF_NO_PI: libc::c_short = 0x1000;
/// `thread::sleep` overshoots by tens of µs; the last stretch before a packet is due is spun instead.
const SPIN: Duration = Duration::from_micros(150);

fn tun(name: &str) -> std::io::Result<File> {
    // SAFETY: a NUL-terminated literal path.
    let fd = unsafe { libc::open(c"/dev/net/tun".as_ptr(), libc::O_RDWR) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut req = [0u8; 40];
    req[..name.len()].copy_from_slice(name.as_bytes());
    req[16..18].copy_from_slice(&(IFF_TUN | IFF_NO_PI).to_ne_bytes());
    // SAFETY: `fd` is an open TUN descriptor and `req` is an `ifreq`-sized buffer that outlives the call.
    if unsafe { libc::ioctl(fd, TUNSETIFF, req.as_mut_ptr()) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: `fd` was opened above and is owned by nothing else.
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn direction(mut from: File, mut to: File, delay: Duration) {
    let (tx, rx) = mpsc::channel::<(Instant, Vec<u8>)>();
    std::thread::spawn(move || {
        for (due, packet) in rx {
            let now = Instant::now();
            if due > now + SPIN {
                std::thread::sleep(due - now - SPIN);
            }
            while Instant::now() < due {
                std::hint::spin_loop();
            }
            let _ = to.write_all(&packet);
        }
    });
    let mut buf = vec![0u8; 65_536];
    while let Ok(n) = from.read(&mut buf) {
        if tx.send((Instant::now() + delay, buf[..n].to_vec())).is_err() {
            return;
        }
    }
}

/// Creates TUN devices `a` and `b`, prints `ready`, and forwards between them until killed.
pub fn run(a: &str, b: &str, one_way: Duration) -> anyhow::Result<()> {
    let (ta, tb) = (tun(a)?, tun(b)?);
    let (ta2, tb2) = (ta.try_clone()?, tb.try_clone()?);
    println!("ready");
    let up = std::thread::spawn(move || direction(ta, tb2, one_way));
    direction(tb, ta2, one_way);
    let _ = up.join();
    Ok(())
}
