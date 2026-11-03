package admin

import (
	"net/http"
	"time"

	"wowrouter/server/internal/gateway"
	"wowrouter/server/internal/mitm"
)

// Modified by WowRouter.
// Derived from Antirion (https://github.com/eliasbiondo/antirion), Copyright 2026 Elias Biondo, Apache-2.0.
//
// API serves the admin console at /admin/v1 and owns the gateway engine.
type API struct {
	Store   *Store
	Engine  *gateway.Engine
	Version string
	OpenAPI []byte
	Proxy   *mitm.Proxy
}

// Authorized reports whether the request has a console session or bootstrap token.
func (a *API) Authorized(r *http.Request) bool {
	if a == nil {
		return false
	}
	return a.authorized(r)
}

func New(store *Store, version string) *API {
	eng := gateway.New(store)
	if store != nil && eng.Breakers != nil {
		eng.Breakers.OnCool = store.SaveKeyCooldown
		for _, row := range store.KeyCooldowns() {
			eng.Breakers.Restore(row.Provider, row.KeyID, time.Unix(row.Until, 0))
		}
	}
	return &API{Store: store, Engine: eng, Version: version, Proxy: &mitm.Proxy{}}
}
