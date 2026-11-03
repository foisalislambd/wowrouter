package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"airoute/server/internal/store"
)

const maxBatchLines = 40

func (s *Server) uploadFile(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "upload a multipart file", "invalid_request_error", "invalid_body")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "the file field is required", "invalid_request_error", "invalid_body")
		return
	}
	defer file.Close()
	purpose := r.FormValue("purpose")
	if purpose == "" {
		purpose = "batch"
	}
	raw, err := io.ReadAll(io.LimitReader(file, 2<<20))
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_body")
		return
	}
	dir := filepath.Join(s.DataDir, "batch-files")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	item, err := s.Store.InsertFile(header.Filename, purpose, "", len(raw))
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	path := filepath.Join(dir, item.ID)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		_, _ = s.Store.DeleteFile(item.ID)
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	if _, err := s.Store.DeleteFile(item.ID); err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	saved, err := s.Store.InsertFile(header.Filename, purpose, path, len(raw))
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	writeJSON(w, http.StatusOK, fileObject(saved))
}

func (s *Server) listFiles(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	items, err := s.Store.ListFiles()
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	data := make([]map[string]any, 0, len(items))
	for _, item := range items {
		data = append(data, fileObject(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": data})
}

func (s *Server) getFile(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	item, err := s.Store.GetFile(r.PathValue("id"))
	if err == store.ErrNotFound {
		writeOpenAIError(w, http.StatusNotFound, "file not found", "invalid_request_error", "not_found")
		return
	}
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	if strings.HasSuffix(r.URL.Path, "/content") {
		http.ServeFile(w, r, item.Path)
		return
	}
	writeJSON(w, http.StatusOK, fileObject(item))
}

func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	path, err := s.Store.DeleteFile(r.PathValue("id"))
	if err == store.ErrNotFound {
		writeOpenAIError(w, http.StatusNotFound, "file not found", "invalid_request_error", "not_found")
		return
	}
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	_ = os.Remove(path)
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "object": "file", "deleted": true})
}

func (s *Server) createBatch(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	var body struct {
		InputFileID string `json:"input_file_id"`
		Endpoint    string `json:"endpoint"`
	}
	if err := readJSON(r, &body); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid JSON body", "invalid_request_error", "invalid_body")
		return
	}
	if body.Endpoint == "" {
		body.Endpoint = "/v1/chat/completions"
	}
	if body.Endpoint != "/v1/chat/completions" {
		writeOpenAIError(w, http.StatusBadRequest, "only /v1/chat/completions batches are supported", "invalid_request_error", "invalid_endpoint")
		return
	}
	file, err := s.Store.GetFile(body.InputFileID)
	if err == store.ErrNotFound {
		writeOpenAIError(w, http.StatusNotFound, "input file not found", "invalid_request_error", "not_found")
		return
	}
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	raw, err := os.ReadFile(file.Path)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "could not read the input file", "invalid_request_error", "invalid_file")
		return
	}
	lines := nonEmptyLines(raw)
	if len(lines) == 0 || len(lines) > maxBatchLines {
		writeOpenAIError(w, http.StatusBadRequest, "a batch file must contain 1 to 40 JSONL lines", "invalid_request_error", "invalid_file")
		return
	}
	job, err := s.Store.CreateBatch(file.ID, body.Endpoint)
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	var output, errorsBuf bytes.Buffer
	okN, errN := 0, 0
	for _, line := range lines {
		var row struct {
			CustomID string          `json:"custom_id"`
			Body     json.RawMessage `json:"body"`
		}
		if json.Unmarshal(line, &row) != nil || len(row.Body) == 0 {
			errN++
			writeBatchLine(&errorsBuf, row.CustomID, "invalid JSONL line")
			continue
		}
		rec := newCapture()
		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(row.Body))
		if err != nil {
			errN++
			writeBatchLine(&errorsBuf, row.CustomID, err.Error())
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		s.proxyChat(rec, req, "batch", keyID)
		if rec.Code >= 400 {
			errN++
			writeBatchLine(&errorsBuf, row.CustomID, upstreamErrorMessage(rec.buf.Bytes()))
			continue
		}
		okN++
		encoded, _ := json.Marshal(map[string]any{"custom_id": row.CustomID, "response": json.RawMessage(rec.buf.Bytes())})
		output.Write(encoded)
		output.WriteByte('\n')
	}
	status := "completed"
	if errN > 0 && okN == 0 {
		status = "failed"
	}
	outFile := s.storeBatchResult(output.Bytes(), "output.jsonl")
	errFile := s.storeBatchResult(errorsBuf.Bytes(), "errors.jsonl")
	counts, _ := json.Marshal(map[string]int{"total": len(lines), "completed": okN, "failed": errN})
	_ = s.Store.FinishBatch(job.ID, status, outFile, errFile, string(counts))
	item, err := s.Store.GetBatch(job.ID)
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	writeJSON(w, http.StatusOK, batchObject(item))
}

func (s *Server) getBatch(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	item, err := s.Store.GetBatch(r.PathValue("id"))
	if err == store.ErrNotFound {
		writeOpenAIError(w, http.StatusNotFound, "batch not found", "invalid_request_error", "not_found")
		return
	}
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	writeJSON(w, http.StatusOK, batchObject(item))
}

func (s *Server) storeBatchResult(raw []byte, name string) string {
	if len(raw) == 0 {
		return ""
	}
	dir := filepath.Join(s.DataDir, "batch-files")
	_ = os.MkdirAll(dir, 0o700)
	item, err := s.Store.InsertFile(name, "batch_output", "", len(raw))
	if err != nil {
		return ""
	}
	path := filepath.Join(dir, item.ID)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return ""
	}
	_, _ = s.Store.DeleteFile(item.ID)
	saved, err := s.Store.InsertFile(name, "batch_output", path, len(raw))
	if err != nil {
		return ""
	}
	return saved.ID
}

func fileObject(item store.StoredFile) map[string]any {
	return map[string]any{
		"id": item.ID, "object": "file", "bytes": item.Bytes, "filename": item.Filename,
		"purpose": item.Purpose, "created_at": item.CreatedAt,
	}
}

func batchObject(item store.Batch) map[string]any {
	var counts any
	if json.Unmarshal([]byte(item.RequestCounts), &counts) != nil {
		counts = map[string]int{}
	}
	return map[string]any{
		"id": item.ID, "object": "batch", "endpoint": item.Endpoint, "status": item.Status,
		"input_file_id": item.InputFileID, "output_file_id": item.OutputFileID, "error_file_id": item.ErrorFileID,
		"request_counts": counts, "created_at": item.CreatedAt, "completed_at": item.CompletedAt,
	}
}

func nonEmptyLines(raw []byte) [][]byte {
	var out [][]byte
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) > 0 {
			out = append(out, append([]byte(nil), line...))
		}
	}
	return out
}

func writeBatchLine(buf *bytes.Buffer, id, message string) {
	raw, _ := json.Marshal(map[string]any{"custom_id": id, "error": map[string]string{"message": message}})
	buf.Write(raw)
	buf.WriteByte('\n')
}
