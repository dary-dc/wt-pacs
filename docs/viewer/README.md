# The viewer product

A complete 2D DICOM viewer for diagnostic reading. Breast imaging comes first: FFDM and synthesized 2D, DBT slices,
breast ultrasound stills and cine, and ABUS. Other 2D follows: CR/DX, CT and MR read slice by slice, US, and XA/RF
runs. It targets desktop and mobile on lossy wireless. Pixels are lossless and bit-exact, and there is no
low-resolution preview; both are decided. This line of work is kept apart from the current client
([`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../../client/README.md`](../../client/README.md)), which supplies its
transport, decode, cache and paint.

| file | |
| --- | --- |
| [`requirements.md`](requirements.md) | what the viewer must do and what is nice to have, on what authority, and what the client has today |
