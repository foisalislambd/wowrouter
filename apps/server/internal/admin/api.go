package admin

import "wowrouter/server/internal/gateway"

// API is the gateway runtime the public HTTP server uses.
// The browser talks to the panel API, not to this type's HTTP routes.
type API struct {
	Store   *Store
	Engine  *gateway.Engine
	Version string
}

func New(store *Store, version string) *API {
	return &API{Store: store, Engine: gateway.New(store), Version: version}
}
