# frames_500x64k

Synthetic SBND: 500 frames x 64000 bytes (32 MB). Lab only.

Exists because an 80-frame series is wholly cached within seconds by a client whose
cache never evicts, after which no jump can miss and the informative sample count
collapses (nz_n = 6 over a 693-step, 59-jump trace).
