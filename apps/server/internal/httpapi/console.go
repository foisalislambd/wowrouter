package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) panel() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ui" || strings.HasPrefix(r.URL.Path, "/ui/") {
			target := strings.TrimPrefix(r.URL.Path, "/ui")
			if target == "" {
				target = "/"
			}
			http.Redirect(w, r, target, http.StatusFound)
			return
		}
		if s.ConsoleDir == "" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("<p>WowRouter panel is not built. From the repo root run <code>npm run build:panel</code>.</p>"))
			return
		}
		root, err := filepath.Abs(s.ConsoleDir)
		if err != nil {
			http.Error(w, "panel unavailable", http.StatusInternalServerError)
			return
		}
		rel := strings.TrimPrefix(r.URL.Path, "/")
		if rel == "" {
			rel = "index.html"
		}
		file := filepath.Join(root, filepath.Clean("/"+rel))
		abs, err := filepath.Abs(file)
		if err != nil || (abs != root && !strings.HasPrefix(abs, root+string(os.PathSeparator))) {
			http.NotFound(w, r)
			return
		}
		if info, statErr := os.Stat(abs); statErr == nil && !info.IsDir() {
			http.ServeFile(w, r, abs)
			return
		}
		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	})
}
