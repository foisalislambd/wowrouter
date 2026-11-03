package admin

import (
	"context"
	"database/sql"
	"strings"
)

// sqlDB is the subset of database/sql this store uses.
// Postgres connections rebind '?' placeholders before each call.
type sqlDB interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
	Close() error
	PingContext(ctx context.Context) error
}

type pgDB struct{ *sql.DB }

func (p pgDB) Exec(query string, args ...any) (sql.Result, error) {
	return p.DB.Exec(rebind(query), args...)
}

func (p pgDB) Query(query string, args ...any) (*sql.Rows, error) {
	return p.DB.Query(rebind(query), args...)
}

func (p pgDB) QueryRow(query string, args ...any) *sql.Row {
	return p.DB.QueryRow(rebind(query), args...)
}

func (s *Store) execScript(script string) error {
	if s.driver != "postgres" {
		_, err := s.db.Exec(script)
		return err
	}
	for _, stmt := range splitSQL(script) {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func splitSQL(script string) []string {
	var out []string
	var b strings.Builder
	in := false
	for _, r := range script {
		if r == '\'' {
			in = !in
		}
		if r == ';' && !in {
			stmt := strings.TrimSpace(b.String())
			if stmt != "" {
				out = append(out, stmt)
			}
			b.Reset()
			continue
		}
		b.WriteRune(r)
	}
	if stmt := strings.TrimSpace(b.String()); stmt != "" {
		out = append(out, stmt)
	}
	return out
}

func rebind(query string) string {
	var b strings.Builder
	in := false
	n := 0
	for _, r := range query {
		if r == '\'' {
			in = !in
			b.WriteRune(r)
			continue
		}
		if r == '?' && !in {
			n++
			b.WriteByte('$')
			b.WriteString(itoa(n))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
