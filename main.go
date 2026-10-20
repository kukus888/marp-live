package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

//go:embed all:web/static
var staticFS embed.FS

var nameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 _.-]{0,100}$`)

type store struct {
	dir string
	ext string
}

func (s *store) path(name string) (string, bool) {
	name = strings.TrimSuffix(name, s.ext)
	if !nameRe.MatchString(name) || strings.Contains(name, "..") {
		return "", false
	}
	return filepath.Join(s.dir, name+s.ext), true
}

func (s *store) handler(prefix string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(prefix, func(w http.ResponseWriter, r *http.Request) {
		entries, _ := os.ReadDir(s.dir)
		names := []string{}
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), s.ext) {
				names = append(names, strings.TrimSuffix(e.Name(), s.ext))
			}
		}
		sort.Strings(names)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(names)
	})
	mux.HandleFunc(prefix+"{name}", func(w http.ResponseWriter, r *http.Request) {
		p, ok := s.path(r.PathValue("name"))
		if !ok {
			http.Error(w, "invalid name", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodGet:
			b, err := os.ReadFile(p)
			if err != nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write(b)
		case http.MethodPut:
			b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 10<<20))
			if err != nil {
				http.Error(w, "too large", http.StatusRequestEntityTooLarge)
				return
			}
			if err := os.WriteFile(p, b, 0o644); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			if err := os.Remove(p); err != nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	return mux
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address")
	data := flag.String("data", "./data", "data directory (holds presentations/ and styles/)")
	flag.Parse()

	pres := &store{filepath.Join(*data, "presentations"), ".md"}
	styles := &store{filepath.Join(*data, "styles"), ".css"}
	for _, s := range []*store{pres, styles} {
		if err := os.MkdirAll(s.dir, 0o755); err != nil {
			log.Fatal(err)
		}
	}
	sub, _ := fs.Sub(staticFS, "web/static")
	mux := http.NewServeMux()
	mux.Handle("/api/presentations/", http.StripPrefix("/api", pres.handler("/presentations/")))
	mux.Handle("/api/styles/", http.StripPrefix("/api", styles.handler("/styles/")))
	mux.Handle("/", http.FileServer(http.FS(sub)))
	fmt.Printf("marp-live listening on http://%s (data: %s)\n", *addr, *data)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
