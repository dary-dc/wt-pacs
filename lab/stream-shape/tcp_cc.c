// LD_PRELOAD: every listening socket takes $WTPACS_TCP_CC as its congestion controller, and the
// sockets it accepts inherit it, so the server's TCP controller is the cell's, not the host's.
// Inside `unshare -rn` any available one is allowed. lab/stream-shape/README.md
#define _GNU_SOURCE
#include <dlfcn.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>

int listen(int fd, int backlog) {
  static int (*real)(int, int);
  if (!real) real = (int (*)(int, int))dlsym(RTLD_NEXT, "listen");
  const char *cc = getenv("WTPACS_TCP_CC");
  if (cc && setsockopt(fd, IPPROTO_TCP, TCP_CONGESTION, cc, strlen(cc)) != 0) abort();
  return real(fd, backlog);
}
