// The deploy template's static host — its paths, isolation headers and gzip — over TLS with
// HTTP/2 and, on the same port, HTTP/3. It sends no Alt-Svc: a browser finds the HTTP/3 plane
// only through an HTTPS DNS record. lab/page-open/README.md §The static plane
//
//	go run . ROOT ADDR CERT KEY
package main

import (
	"bytes"
	"compress/gzip"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/quic-go/quic-go/http3"
)

var compressible = map[string]bool{
	".js": true, ".mjs": true, ".ts": true, ".css": true, ".json": true, ".wasm": true, ".svg": true,
}

func main() {
	root, addr, cert, key := os.Args[1], os.Args[2], os.Args[3], os.Args[4]
	mime.AddExtensionType(".ts", "text/typescript")
	mime.AddExtensionType(".wasm", "application/wasm")
	mime.AddExtensionType(".js", "text/javascript")
	mime.AddExtensionType(".mjs", "text/javascript")

	files := http.FileServer(http.Dir(root))
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		if r.URL.Path == "/wt/dev-transport.json" {
			r.URL.Path = "/client/dev-transport.json"
		}
		name := filepath.Join(root, filepath.FromSlash(path.Clean("/"+r.URL.Path)))
		ext := filepath.Ext(name)
		if !compressible[ext] || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			files.ServeHTTP(w, r)
			return
		}
		raw, err := os.ReadFile(name)
		if err != nil || len(raw) < 1024 {
			files.ServeHTTP(w, r)
			return
		}
		var body bytes.Buffer
		z, _ := gzip.NewWriterLevel(&body, 6)
		z.Write(raw)
		z.Close()
		w.Header().Set("Content-Type", mime.TypeByExtension(ext))
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		w.Write(body.Bytes())
	})

	go func() { log.Fatal((&http3.Server{Addr: addr, Handler: h}).ListenAndServeTLS(cert, key)) }()
	log.Fatal((&http.Server{Addr: addr, Handler: h}).ListenAndServeTLS(cert, key))
}
