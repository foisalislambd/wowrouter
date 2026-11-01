package admin

import "wowrouter/server/internal/gateway"

// Modified by WowRouter.
// Derived from Antirion (https://github.com/eliasbiondo/antirion), Copyright 2026 Elias Biondo, Apache-2.0.
//
// API serves the admin console at /admin/v1 and owns the gateway engine.
type API struct {
	Store   *Store
	Engine  *gateway.Engine
	Version string
	OpenAPI []byte
}

func New(store *Store, version string) *API {
	return &API{Store: store, Engine: gateway.New(store), Version: version}
}
