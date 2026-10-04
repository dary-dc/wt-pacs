// Two Go clients against the server: `wt` dials a WebTransport session with webtransport-go and
// asks for frame 0; `get` is quic-go's plain HTTP/3 client, which waits for the server's SETTINGS
// and sends a GET. Prints one JSON line of ms from the dial. lab/other-clients/README.md
//
//	go run . wt|get https://127.0.0.1:PORT/
package main

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

func ms(t0 time.Time) float64 { return float64(time.Since(t0).Microseconds()) / 1000 }

func main() {
	mode, url := os.Args[1], os.Args[2]
	tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out := map[string]any{}
	t0 := time.Now()
	if mode == "get" {
		conn, err := quic.DialAddrEarly(ctx, url[len("https://"):len(url)-1], tlsConf, nil)
		if err != nil {
			fail(err)
		}
		cc := (&http3.Transport{}).NewClientConn(conn)
		<-cc.ReceivedSettings()
		out["settings"] = ms(t0)
		req, _ := http.NewRequest(http.MethodGet, url, nil)
		if rsp, err := cc.RoundTrip(req); err != nil {
			out["get"] = err.Error()
		} else {
			out["get"] = rsp.StatusCode
			rsp.Body.Close()
		}
		conn.CloseWithError(0, "done")
	} else {
		d := webtransport.Dialer{TLSClientConfig: tlsConf}
		defer d.Close()
		_, sess, err := d.Dial(ctx, url, nil)
		if err != nil {
			fail(err)
		}
		out["ready"] = ms(t0)
		ask, _ := json.Marshal(map[string]any{"op": "request_frame", "frame": 0})
		stream, err := sess.OpenStreamSync(ctx)
		if err != nil {
			fail(err)
		}
		stream.Write(binary.LittleEndian.AppendUint32(nil, uint32(len(ask))))
		stream.Write(ask)
		uni, err := sess.AcceptUniStream(ctx)
		if err != nil {
			fail(err)
		}
		if _, err := uni.Read(make([]byte, 1)); err != nil {
			fail(err)
		}
		out["first_byte"] = ms(t0)
		sess.CloseWithError(0, "done")
	}
	b, _ := json.Marshal(out)
	fmt.Println(string(b))
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
