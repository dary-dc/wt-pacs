# Deploying so the fast read path actually exists

The [ADR](adr.md) streams frame bytes with `preadv2(RWF_NOWAIT)`: a warm ask takes **no
thread-pool hop at all**, and a cold read returns short rather than parking a Tokio worker.
That depends on the filesystem implementing the flag.

**It is not implemented on overlayfs — which is what a container's own filesystem is.**

The server does not fail there. `FrameStore::open` probes once, and where the answer is no
it falls back to one pooled `pread` per frame. Correct, safe, and **measurably slower with
no error in the logs** — the fallback arm measures 132.5 µs per frame against the accepted
path's 48.4 µs on the validation host ([RERUN.md](RERUN.md) Cell 1). This is not a
hypothetical: the *previous* campaign reached the wrong conclusion partly because it ran on
overlayfs.

## Check before you ship

```bash
cargo build -p check-fastpath --release
./target/release/check-fastpath /path/to/studies      # the directory the server reads from
```

Exit status is the answer, so it can gate a rollout: **0** fast path, **1** fallback,
**2** could not determine.

Point it at the **directory**, not a file — support is a property of the mount. It works
before any study is in place (it creates and removes a probe file).

```
path            /srv/studies
filesystem      ext2/ext3/ext4
read_ahead_kb   128
RWF_NOWAIT      honoured

PASS — the server gets its fast path here.
```

## Measured support

Probed directly on Linux 6.18, and matching the ADR's own table:

| Filesystem | `RWF_NOWAIT` | Note |
| --- | --- | --- |
| ext4 | **honoured** | measured |
| overlayfs | **refused** (`EOPNOTSUPP`) | measured — **this is the container default** |
| tmpfs | **refused** (`EOPNOTSUPP`) | measured — RAM disks, `emptyDir: {medium: Memory}` |
| XFS | *expected to work* | **not measured here** — run the tool on the real host |
| NFS / EFS | *unknown* | **not measured** — run the tool; do not assume |

Only the first three are measured. For anything else the tool is the answer, not this table.

## The fix, in one line

**Serve studies from a mounted volume, never from the container's own layer.** A bind mount
carries the underlying filesystem through, so the fast path comes back — verified: the same
directory inside an overlayfs tree reports `overlayfs / REFUSED`, and with an ext4 bind mount
over it reports `ext2/ext3/ext4 / honoured`.

### Docker

```bash
# WRONG — the study is baked into the image, so it lives on overlayfs
# COPY studies/ /srv/studies      <-- in your Dockerfile
docker run myserver

# RIGHT — a host directory (or named volume) on a real filesystem
docker run -v /srv/studies:/srv/studies:ro myserver
```

The `COPY` case is the easy mistake: it works, tests pass, and the fast path is simply gone.

### docker compose

```yaml
services:
  exact-server:
    image: myserver
    volumes:
      - /srv/studies:/srv/studies:ro     # host path on ext4/XFS
    # NOT: a tmpfs: mount for studies — tmpfs refuses the flag
```

### Kubernetes

```yaml
volumes:
  - name: studies
    persistentVolumeClaim:
      claimName: studies-pvc        # block-backed PV (EBS, PD, Ceph RBD) -> ext4/XFS
  # NOT this — emptyDir with a Memory medium is tmpfs, which refuses the flag:
  #   emptyDir: { medium: Memory }
  # And plain `emptyDir: {}` lands on the node's disk, usually fine, but it is
  # scratch space: verify with check-fastpath and remember it does not survive
  # rescheduling.
containers:
  - name: exact-server
    volumeMounts:
      - { name: studies, mountPath: /srv/studies, readOnly: true }
```

A PVC backed by a **block device** (AWS EBS, GCP PD, Azure Disk, Ceph RBD) is formatted
ext4 or XFS and behaves like a normal disk. A PVC backed by a **network filesystem**
(EFS, Filestore, NFS) is a different question — check it rather than assuming.

### Verify inside the running container

Checking from the host is not the same as checking from where the server actually reads:

```bash
docker exec <container> /usr/local/bin/check-fastpath /srv/studies
kubectl exec <pod> -- /usr/local/bin/check-fastpath /srv/studies
```

Ship the binary in the image (it is small and has no runtime deps beyond libc) and this
becomes a one-command answer at any time. It is also worth running as a startup gate: a
non-zero exit means the deployment is in the slow mode, whatever the manifest says.

## Also worth recording: read-ahead

`check-fastpath` prints `read_ahead_kb` because it is not a footnote. The validation host
ships **8192** (8 MiB) against Linux's **128 KiB** default, and that single knob moves every
measured miss rate by 2–15× ([ACCESS-PATTERNS.md](ACCESS-PATTERNS.md) §4.1). Read-ahead is
what protects *sequential* access under cache pressure; a smaller window makes a
sequential layout degrade much faster.

If your host reports 128 and the published numbers matter to you, record that difference —
it is one of the two constants behind risk **R1** in [SCOREBOARD.md](SCOREBOARD.md).

```bash
cat /sys/block/<dev>/queue/read_ahead_kb          # read
sudo blockdev --setra 16384 /dev/<dev>            # 8 MiB, non-persistent
```

## Summary

| | |
| --- | --- |
| **Do** | Mount a volume backed by ext4/XFS and serve studies from it |
| **Do** | Run `check-fastpath` against the study directory, inside the container, as a deploy gate |
| **Don't** | `COPY` studies into the image, or write them to the container's own layer |
| **Don't** | Put studies on tmpfs or `emptyDir: {medium: Memory}` |
| **Don't** | Assume — the server degrades silently, so the check is the only signal |
