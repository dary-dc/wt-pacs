# Cloud rig — access and key policy

**Host:** `168.138.130.163` (Oracle E2, São Paulo) · **User:** `ubuntu` · passwordless `sudo`
**Deploy path:** `/home/ubuntu/wt-pacs/` · **Why it exists:** `sch_netem` loads on a VM but not in
an agent container, so shaped-link experiments run here.

## Which key

Scripts read `SSH_KEY` and fall back to `$HOME/.ssh/id_ed25519_rig_agent`
(`lab/scripts/cloud_common.sh:12`). The bare `id_ed25519` this used to name was rotated out
and no longer opens the rig. Use one of the two below, per role:

| role | local file | fingerprint |
| --- | --- | --- |
| human / local runs | `~/.ssh/id_ed25519_rig` | `SHA256:c/5omAouR2HsRCK/YheXuT49ZrMjiRStlL9BfRI2YX0` |
| cloud agent | `~/.ssh/id_ed25519_rig_agent` | `SHA256:qz/LiOLq8/Bevhiogyuj9CgXZ9/e3nuUHi5Hicq1Pbc` |

The cloud-agent row changed on **2026-09-07** — see the second rotation record below. The
retired value was `SHA256:CAD0bvPh5zni9qJ5mZhO3UUr+1Fwg7ZMS70O4blE90g`; anything still
quoting it is stale.

```bash
export SSH_KEY=~/.ssh/id_ed25519_rig      # before any lab/scripts/*_cloud.sh
```

Two keys, not one, so the agent's can be revoked without touching human access. **Never hand the
human key to an agent environment.**

## Rotation record — 2026-08-29

The previous key (`SHA256:qWDRS4syk…`, comment `deck-webtransport`, **no passphrase**) was given to a
cloud agent environment. It was rotated the same day.

Scope, established by testing rather than assumption:

| target | was it authorized? |
| --- | --- |
| GitHub | no |
| Gitea (git user and shell) | no |
| **this rig** | **yes — as `ubuntu`, `root`, and `opc`, all with root** |

Both new keys were installed and verified working **before** the old one was removed, so there was no
lockout window. After removal the old key is denied on all three accounts; both new keys work.

An audit before rotation found exactly one authorized key per account, all expected — **no sign the
exposure was used.**

## Rotation record — 2026-09-07 (cloud-agent key)

The cloud-agent key `SHA256:CAD0bvPh5zni9qJ5mZhO3UUr+1Fwg7ZMS70O4blE90g`
(`wt-pacs-cloud-agent-2026-08-29`) was pasted into a chat transcript. It never entered the
repository — verified — but it was rotated on the same reasoning that retired its
predecessor: exposure, not evidence of use, is the trigger.

Scope, established by testing rather than assumption:

| target | was it authorized? |
| --- | --- |
| `ubuntu` on this rig | **yes** — confirmed by a successful login before rotation |
| `root` on this rig | no — `/root/.ssh/authorized_keys` is 0 bytes |
| `opc` on this rig | no — `/home/opc/.ssh/authorized_keys` is 0 bytes |

Both non-`ubuntu` accounts were left empty by the 2026-08-29 rotation, so the "check every
account" lesson below held: it was checked again rather than assumed.

Replacement `SHA256:qz/LiOLq8/Bevhiogyuj9CgXZ9/e3nuUHi5Hicq1Pbc`
(`wt-pacs-cloud-agent-2026-09-07`) was installed and **verified working, including
passwordless `sudo`, before the old key was removed** — no lockout window. After removal the
old key returns `Permission denied (publickey)` on `ubuntu`. `~/.ssh/authorized_keys.bak.*`
was deleted too, so the retired key does not survive in a backup beside the live file. The
human key was not touched and remained the recovery path throughout.

`lab/transport/scripts/cloud_preflight.sh` (now on tag `archive/transport-lab-2026-09`) passed on the new key immediately afterwards, which is what
proved the campaign could still reach the rig.

## The lesson worth keeping

**Removing a key from one account is not revocation.** The first pass removed it from
`~ubuntu/.ssh/authorized_keys` and the key still authenticated, because the same public key was also
installed for `root` and for `opc`. Reporting success at that point would have left a live root
credential in a vendor environment behind a false all-clear.

Check every account before declaring a key revoked:

```bash
sudo bash -c 'for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] && { echo "$f"; ssh-keygen -lf "$f"; }; done'
```

Then prove it negatively — attempt the old key against **each** account and require
`Permission denied` from all of them.

## If a key is exposed again

1. Determine scope by testing, not by assuming — which hosts and services actually accept it
2. Mint the replacement and **verify it works** before removing anything
3. Remove the old public key from **every** account on **every** host
4. Prove denial per account
5. Delete the exposed secret from wherever it was pasted; a deauthorized key is inert but should not
   linger in someone else's environment
