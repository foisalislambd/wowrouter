package migrate

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/secret"

	_ "modernc.org/sqlite"
)

const (
	DBName          = "wowrouter.db"
	LegacyDirName = "airoute-router"
	legacyDBName  = "airoute.db"
	gatewayDBName = "gateway.db"
)

// Prepare copies an older gateway database and local secret files into dataDir.
// Existing files in dataDir are left in place. Source files are not deleted.
func Prepare(dataDir string, sourceDirs []string) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	for _, dir := range sourceDirs {
		copyIfMissing(filepath.Join(dir, "secret.key"), filepath.Join(dataDir, "secret.key"))
		copyIfMissing(filepath.Join(dir, "desktop.json"), filepath.Join(dataDir, "desktop.json"))
	}
	destDB := filepath.Join(dataDir, DBName)
	if _, err := os.Stat(destDB); err == nil {
		return nil
	}
	for _, dir := range sourceDirs {
		src := filepath.Join(dir, gatewayDBName)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		if err := copyDB(src, destDB); err != nil {
			return err
		}
		copyIfMissing(filepath.Join(dir, "bootstrap-token"), filepath.Join(dataDir, "bootstrap-token"))
		return nil
	}
	return nil
}

// Apply imports classic router rows and any gateway database that was not copied
// over wowrouter.db. A second call with the same source files does nothing.
func Apply(store *admin.Store, dataDir string, sourceDirs []string) error {
	stamp, err := loadStamp(dataDir)
	if err != nil {
		return err
	}
	changed := false
	for _, dir := range sourceDirs {
		gatewayPath := filepath.Join(dir, gatewayDBName)
		if _, err := os.Stat(gatewayPath); err == nil {
			id, idErr := fileID(gatewayPath)
			if idErr == nil && stamp.Files[gatewayPath] != id && !sameFile(gatewayPath, filepath.Join(dataDir, DBName)) {
				if err := importGateway(store, gatewayPath); err != nil {
					return err
				}
				stamp.Files[gatewayPath] = id
				changed = true
			} else if idErr == nil && stamp.Files[gatewayPath] == "" {
				stamp.Files[gatewayPath] = id
				changed = true
			}
		}
		classicPath := filepath.Join(dir, legacyDBName)
		if _, err := os.Stat(classicPath); err != nil {
			continue
		}
		id, idErr := fileID(classicPath)
		if idErr != nil || stamp.Files[classicPath] == id {
			continue
		}
		if err := importClassic(store, dir, classicPath); err != nil {
			return err
		}
		stamp.Files[classicPath] = id
		changed = true
	}
	if changed {
		store.FlushLogs()
		return saveStamp(dataDir, stamp)
	}
	return nil
}

type stampFile struct {
	Files map[string]string `json:"files"`
}

func loadStamp(dataDir string) (stampFile, error) {
	path := filepath.Join(dataDir, "import-stamp.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return stampFile{Files: map[string]string{}}, nil
		}
		return stampFile{}, err
	}
	var stamp stampFile
	if err := json.Unmarshal(raw, &stamp); err != nil {
		return stampFile{}, err
	}
	if stamp.Files == nil {
		stamp.Files = map[string]string{}
	}
	return stamp, nil
}

func saveStamp(dataDir string, stamp stampFile) error {
	raw, err := json.MarshalIndent(stamp, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dataDir, "import-stamp.json"), raw, 0o600)
}

func fileID(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano()), nil
}

func sameFile(a, b string) bool {
	aa, errA := filepath.Abs(a)
	bb, errB := filepath.Abs(b)
	return errA == nil && errB == nil && aa == bb
}

func copyIfMissing(src, dst string) {
	if _, err := os.Stat(dst); err == nil {
		return
	}
	in, err := os.Open(src)
	if err != nil {
		return
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err != nil || closeErr != nil {
		_ = os.Remove(dst)
	}
}

func copyDB(src, dst string) error {
	if err := copyFile(src, dst); err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Stat(src + suffix); err == nil {
			if err := copyFile(src+suffix, dst+suffix); err != nil {
				return err
			}
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func openRead(path string) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	dsn := "file:" + abs + "?mode=ro"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func importGateway(dst *admin.Store, path string) error {
	db, err := openRead(path)
	if err != nil {
		return err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT collection, name, spec FROM resources`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var collection, name, specRaw string
		if err := rows.Scan(&collection, &name, &specRaw); err != nil {
			return err
		}
		if _, err := dst.Get(collection, name); err == nil {
			continue
		}
		var spec map[string]any
		if json.Unmarshal([]byte(specRaw), &spec) != nil || spec == nil {
			continue
		}
		if _, err := dst.Put(collection, name, spec, "", false); err != nil {
			return fmt.Errorf("import %s/%s: %w", collection, name, err)
		}
	}
	return rows.Err()
}

func importClassic(store *admin.Store, dir, path string) error {
	key, err := readKey(dir)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	db, err := openRead(path)
	if err != nil {
		return err
	}
	defer db.Close()
	providers, err := classicProviders(db)
	if err != nil {
		return err
	}
	for i := range providers {
		if providers[i].Cipher == "" || key == nil {
			continue
		}
		plain, err := secret.Open(key, providers[i].Cipher)
		if err != nil {
			return fmt.Errorf("decrypt provider %s: %w", providers[i].Slug, err)
		}
		providers[i].Key = plain
	}
	accounts, err := classicAccounts(db, key)
	if err != nil {
		return err
	}
	wanted := map[string]bool{}
	for _, provider := range providers {
		if provider.Enabled || provider.Key != "" || provider.FromUpstream || len(accounts[provider.Slug]) > 0 {
			wanted[provider.Slug] = true
		}
	}
	models, err := classicModels(db)
	if err != nil {
		return err
	}
	activeByProvider := map[string]bool{}
	for _, model := range models {
		if model.Active || providersBySlug(providers, model.Slug).FromUpstream {
			activeByProvider[model.Slug] = true
		}
	}
	for slug := range activeByProvider {
		wanted[slug] = true
	}
	for _, provider := range providers {
		if !wanted[provider.Slug] {
			continue
		}
		spec := map[string]any{
			"type":         providerType(provider.Protocol),
			"enabled":      provider.Enabled,
			"display_name": provider.Display,
			"base_url":     provider.BaseURL,
		}
		if provider.Strategy != "" {
			spec["account_strategy"] = provider.Strategy
		}
		if provider.Key != "" {
			spec["auth"] = map[string]any{"api_key": provider.Key}
		}
		if list := accounts[provider.Slug]; len(list) > 0 {
			spec["accounts"] = list
			if provider.Key == "" {
				if key := asString(asMap(list[0])["api_key"]); key != "" {
					spec["auth"] = map[string]any{"api_key": key}
				}
			}
		}
		if _, err := store.Put("providers", provider.Slug, spec, "", false); err != nil {
			return err
		}
	}
	depByModel := map[string]string{}
	for _, model := range models {
		if !wanted[model.Slug] {
			continue
		}
		if !model.Active && !providersBySlug(providers, model.Slug).FromUpstream {
			continue
		}
		name := deploymentName(model.Slug, model.Upstream)
		spec := map[string]any{
			"provider": model.Slug,
			"model":    model.Upstream,
			"enabled":  model.Active,
			"price": map[string]any{
				"input":  fmt.Sprintf("%g", model.Input),
				"output": fmt.Sprintf("%g", model.Output),
			},
		}
		if _, err := store.Put("deployments", name, spec, "", false); err != nil {
			return err
		}
		depByModel[model.ID] = name
	}
	if err := importFallbacks(store, db, depByModel); err != nil {
		return err
	}
	return importLogs(store, db)
}

type classicProvider struct {
	Slug, Display, Protocol, BaseURL, Key, Cipher, Strategy string
	Enabled, FromUpstream                           bool
}

type classicModel struct {
	ID, Slug, Upstream string
	Active             bool
	Input, Output      float64
}

func classicProviders(db *sql.DB) ([]classicProvider, error) {
	cols := tableColumns(db, "providers")
	query := `SELECT slug, display_name, protocol, base_url, api_key_cipher, enabled FROM providers`
	if !cols["display_name"] {
		return nil, fmt.Errorf("providers table is missing display_name")
	}
	rows, err := db.Query(`SELECT slug, display_name, protocol, base_url, api_key_cipher, enabled,
		COALESCE(key_optional, 0), COALESCE(models_from_upstream, 0), COALESCE(account_strategy, '') FROM providers`)
	if err != nil {
		rows, err = db.Query(query)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []classicProvider
	extended := true
	for rows.Next() {
		var item classicProvider
		var cipher string
		var enabled, optional, upstream int
		if extended {
			if err := rows.Scan(&item.Slug, &item.Display, &item.Protocol, &item.BaseURL, &cipher, &enabled, &optional, &upstream, &item.Strategy); err != nil {
				extended = false
			} else {
		item.Enabled = enabled == 1
		item.FromUpstream = upstream == 1
		item.Cipher = cipher
		_ = optional
		out = append(out, item)
		continue
			}
		}
	}
	if extended {
		return out, rows.Err()
	}
	rows.Close()
	rows, err = db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out = nil
	for rows.Next() {
		var item classicProvider
		var cipher string
		var enabled int
		if err := rows.Scan(&item.Slug, &item.Display, &item.Protocol, &item.BaseURL, &cipher, &enabled); err != nil {
			return nil, err
		}
		item.Enabled = enabled == 1
		item.Cipher = cipher
		out = append(out, item)
	}
	return out, rows.Err()
}

func classicModels(db *sql.DB) ([]classicModel, error) {
	rows, err := db.Query(`SELECT id, provider_slug, upstream_id, active, input_usd_per_million, output_usd_per_million FROM models`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []classicModel
	for rows.Next() {
		var item classicModel
		var active int
		if err := rows.Scan(&item.ID, &item.Slug, &item.Upstream, &active, &item.Input, &item.Output); err != nil {
			return nil, err
		}
		item.Active = active == 1
		out = append(out, item)
	}
	return out, rows.Err()
}

func classicAccounts(db *sql.DB, key []byte) (map[string][]any, error) {
	if !tableColumns(db, "provider_accounts")["id"] {
		return map[string][]any{}, nil
	}
	rows, err := db.Query(`SELECT provider_slug, name, api_key_cipher, priority, enabled FROM provider_accounts ORDER BY priority, created_at`)
	if err != nil {
		return map[string][]any{}, nil
	}
	defer rows.Close()
	out := map[string][]any{}
	for rows.Next() {
		var slug, name, cipher string
		var priority, enabled int
		if err := rows.Scan(&slug, &name, &cipher, &priority, &enabled); err != nil {
			return nil, err
		}
		plain, err := secret.Open(key, cipher)
		if err != nil {
			return nil, err
		}
		out[slug] = append(out[slug], map[string]any{
			"name": name, "api_key": plain, "priority": priority, "enabled": enabled == 1,
		})
	}
	return out, rows.Err()
}

func importFallbacks(store *admin.Store, db *sql.DB, deps map[string]string) error {
	if !tableColumns(db, "fallbacks")["id"] {
		return nil
	}
	rows, err := db.Query(`SELECT id, name FROM fallbacks`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	type chain struct{ id, name string }
	var chains []chain
	for rows.Next() {
		var item chain
		if err := rows.Scan(&item.id, &item.name); err != nil {
			return err
		}
		chains = append(chains, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range chains {
		steps, err := db.Query(`SELECT model_id FROM fallback_steps WHERE fallback_id = ? ORDER BY position`, item.id)
		if err != nil {
			return err
		}
		var children []any
		for steps.Next() {
			var modelID string
			if err := steps.Scan(&modelID); err != nil {
				steps.Close()
				return err
			}
			if dep := deps[modelID]; dep != "" {
				children = append(children, map[string]any{"type": "deployment", "deployment": dep})
			}
		}
		steps.Close()
		if len(children) == 0 {
			continue
		}
		route := "fallback-" + item.id
		if _, err := store.Put("routes", route, map[string]any{
			"enabled": true,
			"tree":    map[string]any{"type": "fallback", "children": children},
		}, "", false); err != nil {
			return err
		}
		if _, err := store.Put("models", "fallback/"+item.id, map[string]any{
			"enabled": true, "route": route, "display_name": item.name,
		}, "", false); err != nil {
			return err
		}
	}
	return nil
}

func importLogs(store *admin.Store, db *sql.DB) error {
	rows, err := db.Query(`SELECT id, created_at, model_id, status_code, latency_ms, prompt_tokens, completion_tokens, error_message FROM request_logs ORDER BY id DESC LIMIT 2000`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var created, model, message string
		var status, latency, prompt, completion int
		if err := rows.Scan(&id, &created, &model, &status, &latency, &prompt, &completion, &message); err != nil {
			return err
		}
		store.AddLog(map[string]any{
			"id": idString(id), "started_at": created, "model": model, "status_code": status,
			"provider": "", "key": "", "error_message": message,
			"usage":  map[string]any{"input": prompt, "output": completion},
			"timing": map[string]any{"total_ms": latency},
		})
	}
	return rows.Err()
}

func idString(id int64) string {
	return fmt.Sprintf("legacy-%d", id)
}

func deploymentName(slug, upstream string) string {
	raw := slug + "-" + upstream
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	name := b.String()
	if len(name) > 120 {
		sum := sha256.Sum256([]byte(raw))
		name = name[:80] + "-" + hex.EncodeToString(sum[:4])
	}
	return name
}

func providerType(protocol string) string {
	switch protocol {
	case "anthropic_messages":
		return "anthropic"
	case "gemini_generate":
		return "gemini"
	case "openai_chat", "":
		return "openai"
	default:
		return "openai_compatible"
	}
}

func providersBySlug(list []classicProvider, slug string) classicProvider {
	for _, item := range list {
		if item.Slug == slug {
			return item
		}
	}
	return classicProvider{}
}

func tableColumns(db *sql.DB, table string) map[string]bool {
	out := map[string]bool{}
	rows, err := db.Query(fmt.Sprintf(`SELECT name FROM pragma_table_info('%s')`, table))
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil {
			out[name] = true
		}
	}
	return out
}

func readKey(dir string) ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "secret.key"))
	if err != nil {
		return nil, err
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("secret key in %s has the wrong length", dir)
	}
	return raw, nil
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}
