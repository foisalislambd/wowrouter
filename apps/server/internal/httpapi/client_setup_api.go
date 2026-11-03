package httpapi

import (
	"net/http"
	"os"

	"airoute/server/internal/clientsetup"
)

func (s *Server) clientSetup(w http.ResponseWriter, r *http.Request) {
	home, err := os.UserHomeDir()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if r.Method == http.MethodGet {
		targets := clientsetup.List(home)
		for i := range targets {
			if info, err := os.Stat(targets[i].Path); err == nil && !info.IsDir() {
				targets[i].Exists = true
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"clients": targets})
		return
	}
	var body struct {
		Client    string `json:"client"`
		RouterKey string `json:"routerKey"`
		Confirm   bool   `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	origin := "http://" + s.Addr
	result, err := clientsetup.Write(home, s.backupDir(), body.Client, origin+"/v1", origin, body.RouterKey, body.Confirm)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) clientRestore(w http.ResponseWriter, r *http.Request) {
	home, err := os.UserHomeDir()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var body struct {
		Client  string `json:"client"`
		Confirm bool   `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	result, err := clientsetup.Restore(home, s.backupDir(), body.Client, body.Confirm)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) backupDir() string {
	return s.DataDir + "/client-backups"
}
