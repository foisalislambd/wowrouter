package admin

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// OpenPostgres opens a server deployment database.
// dataDir still holds secret.key and the bootstrap token.
func OpenPostgres(dsn, dataDir string) (*Store, string, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, "", err
	}
	raw, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, "", err
	}
	raw.SetMaxOpenConns(8)
	s := &Store{db: pgDB{DB: raw}, driver: "postgres"}
	if err := s.migrate(); err != nil {
		raw.Close()
		return nil, "", err
	}
	token, err := s.ensureBootstrap(dataDir)
	if err != nil {
		raw.Close()
		return nil, "", err
	}
	if err := s.ensureTenancy(); err != nil {
		raw.Close()
		return nil, "", err
	}
	s.cacheExact = map[string]string{}
	s.loadCache()
	s.logs = make(chan logItem, 256)
	s.logDone = make(chan struct{})
	go s.logger()
	return s, token, nil
}

// OpenDatabase picks SQLite or Postgres from a URL.
// An empty URL or a file path uses SQLite.
func OpenDatabase(databaseURL, sqlitePath, dataDir string) (*Store, string, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return Open(sqlitePath)
	}
	u, err := url.Parse(databaseURL)
	if err != nil {
		return nil, "", err
	}
	switch u.Scheme {
	case "postgres", "postgresql":
		return OpenPostgres(databaseURL, dataDir)
	case "sqlite", "file", "":
		path := sqlitePath
		if u.Path != "" && u.Scheme != "" {
			path = u.Path
		}
		return Open(path)
	default:
		return nil, "", fmt.Errorf("unsupported database %s", u.Scheme)
	}
}
