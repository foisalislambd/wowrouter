package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) console() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.ConsoleDir == "" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("<p>WowRouter console is not built. From <code>apps/console</code> run <code>pnpm install</code> and <code>pnpm build</code>.</p>"))
			return
		}
		rel := strings.TrimPrefix(r.URL.Path, "/ui")
		rel = strings.TrimPrefix(rel, "/")
		if rel == "" {
			rel = "index.html"
		}
		root, err := filepath.Abs(s.ConsoleDir)
		if err != nil {
			http.Error(w, "console unavailable", http.StatusInternalServerError)
			return
		}
		file := filepath.Join(root, filepath.Clean("/"+rel))
		abs, err := filepath.Abs(file)
		if err != nil || (abs != root && !strings.HasPrefix(abs, root+string(os.PathSeparator))) {
			http.NotFound(w, r)
			return
		}
		if info, err := os.Stat(abs); err == nil && info.IsDir() {
			abs = filepath.Join(abs, "index.html")
		}
		if _, err := os.Stat(abs); err != nil {
			http.ServeFile(w, r, filepath.Join(root, "404.html"))
			return
		}
		http.ServeFile(w, r, abs)
	})
}
