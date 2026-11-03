package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"airoute/server/internal/store"
)

type routeDecision struct {
	Asked    string
	Strategy string
}

type decisionCtxKey struct{}

func withDecision(ctx context.Context, decision routeDecision) context.Context {
	return context.WithValue(ctx, decisionCtxKey{}, decision)
}

func decisionFrom(ctx context.Context) (routeDecision, bool) {
	decision, ok := ctx.Value(decisionCtxKey{}).(routeDecision)
	return decision, ok
}

func noteRoute(r *http.Request, modelID string) string {
	decision, ok := decisionFrom(r.Context())
	if !ok || decision.Strategy == "" {
		return ""
	}
	if modelID == "" {
		return decision.Strategy
	}
	return decision.Strategy + " → " + modelID
}

func (s *Server) addRouteLog(r *http.Request, input store.LogInput) error {
	if r != nil && input.RouteNote == "" {
		input.RouteNote = noteRoute(r, input.ModelID)
	}
	err := s.Store.AddLog(input)
	if err == nil {
		go s.deliverWebhooks(input)
	}
	return err
}

func stampDecision(w http.ResponseWriter, r *http.Request, route store.Route, prompt, completion int) {
	decision, ok := decisionFrom(r.Context())
	if !ok {
		return
	}
	w.Header().Set("X-WowRouter-Model", route.Model.ID)
	w.Header().Set("X-WowRouter-Strategy", decision.Strategy)
	if decision.Asked != "" {
		w.Header().Set("X-WowRouter-Asked", decision.Asked)
	}
	if prompt == 0 && completion == 0 {
		return
	}
	w.Header().Set("X-WowRouter-Prompt-Tokens", strconv.Itoa(prompt))
	w.Header().Set("X-WowRouter-Completion-Tokens", strconv.Itoa(completion))
	w.Header().Set("X-WowRouter-Cost-Usd", strconv.FormatFloat(store.TokenCost(route.Model, prompt, completion), 'f', 6, 64))
}
