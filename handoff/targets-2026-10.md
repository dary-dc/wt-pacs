# Targets, 2026-10 (the owner's answers go here)

The design reviews of 2026-10-20 and 22 read this file. A question left unanswered is reviewed across a plausible
band and says so. Answers are the owner's; an agent only records them.

| # | Question | Why it decides something | Answer |
|---|---|---|---|
| 1 | Viewers per server at once, and how many of them loading a series (a fill) at the same time | Disk queue depth, executor threads, memory per session (#88, the ring's memlock) | |
| 2 | Series that matter, typical and largest: frames × frame size (e.g. mammography 4 × ~50 MB, DBT 60–100 slices, CT 500–2 000 × ~0.5 MB, US cine) | Whether the working set fits the page cache; fill vs. tile reader | |
| 3 | Storage under the series: local NVMe, SATA SSD, HDD, or network (NFS, object store) | Where reads wait; whether io_uring or the pool wins; readahead | |
| 4 | The server host: cores, RAM, container or bare metal, SELinux | The saturation point; D4/D5 apply or not | |
| 5 | Clients: share on phones vs. desktops; links (Wi-Fi, LTE/5G), with typical RTT and loss | Congestion controller, ask-during-fill, OPFS quotas (iOS Safari) | |
| 6 | The numbers to beat: time to first image, time to the whole series, and an ask's p99 while others fill — target values or "as low as possible" | What a review optimises for, and when a tie is good enough | |
| 7 | Reopening: how often a user reopens the same series, and how long the client may keep it | OPFS cache size and eviction | |
