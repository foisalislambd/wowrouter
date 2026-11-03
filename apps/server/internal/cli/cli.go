// Package cli is the wowrouter command line, including a remote mode.
package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"wowrouter/server/internal/acp"
	"wowrouter/server/internal/clients"
	"wowrouter/server/internal/combo"
	"wowrouter/server/internal/compress"
	"wowrouter/server/internal/presets"
	"wowrouter/server/internal/tunnel"
)

// Run executes a subcommand. args[0] is the command name.
func Run(args []string) int {
	if len(args) == 0 {
		usage()
		return 2
	}
	base := strings.TrimRight(env("WOWROUTER_URL", "http://127.0.0.1:8787"), "/")
	token := os.Getenv("WOWROUTER_TOKEN")
	switch args[0] {
	case "help", "-h", "--help":
		usage()
		return 0
	case "version":
		fmt.Println("wowrouter 1.1.8")
		return 0
	case "doctor":
		return doctor(base)
	case "models":
		return getJSON(base+"/v1/models", token)
	case "providers":
		return getJSON(base+"/admin/v1/providers", token)
	case "combos":
		return getJSON(base+"/admin/v1/combos", token)
	case "presets":
		q := ""
		if len(args) > 1 {
			q = args[1]
		}
		n := 0
		for _, p := range presets.Search(q, false) {
			free := ""
			if p.Free {
				free = " free"
			}
			fmt.Printf("%s\t%s%s\t%s\n", p.ID, p.Name, free, p.BaseURL)
			n++
			if n >= 50 && q == "" {
				fmt.Printf("… %d presets total. Pass a query to filter.\n", presets.Count())
				break
			}
		}
		return 0
	case "strategies":
		fmt.Println(strings.Join(combo.Strategies(), "\n"))
		fmt.Println(strings.Join(combo.AutoModels(), "\n"))
		return 0
	case "compress":
		fmt.Println("engines: " + strings.Join(compress.Engines(), ", "))
		fmt.Println("not implemented: " + strings.Join(compress.NotImplemented(), ", "))
		return 0
	case "configure":
		if len(args) < 2 {
			fmt.Println("usage: wowrouter configure <claude|codex|cursor|cline|opencode|copilot> [--write path]")
			return 2
		}
		file, body, ok := clients.Snippet(args[1], base, tokenOr(token))
		if !ok {
			fmt.Println("unknown client")
			return 2
		}
		if len(args) >= 4 && args[2] == "--write" {
			if err := os.WriteFile(args[3], []byte(body), 0o600); err != nil {
				fmt.Println(err)
				return 1
			}
			fmt.Println("wrote", args[3])
			return 0
		}
		fmt.Printf("# %s\n%s", file, body)
		return 0
	case "connect":
		fmt.Printf("url %s\n", base)
		return doctor(base)
	case "acp":
		if err := acp.Run(os.Stdin, os.Stdout, base, token); err != nil {
			fmt.Println(err)
			return 1
		}
		return 0
	case "relay":
		addr := "127.0.0.1:8791"
		if len(args) > 1 {
			addr = args[1]
		}
		if token == "" {
			fmt.Println("set WOWROUTER_TOKEN to the tunnel bearer token")
			return 2
		}
		fmt.Println("relay", addr)
		return relay(addr, token)
	case "chat":
		if len(args) < 3 {
			fmt.Println("usage: wowrouter chat <model> <prompt>")
			return 2
		}
		return chat(base, token, args[1], strings.Join(args[2:], " "))
	default:
		usage()
		return 2
	}
}

func usage() {
	fmt.Println(`wowrouter commands:
  version
  doctor
  connect
  models
  providers
  combos
  presets [query]
  strategies
  compress
  configure <claude|codex|cursor|cline|opencode|copilot>
  acp
  relay [addr]
  chat <model> <prompt>

Remote mode uses WOWROUTER_URL and WOWROUTER_TOKEN.`)
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func tokenOr(token string) string {
	if token != "" {
		return token
	}
	return "sk-wowrouter-YOUR-KEY"
}

func relay(addr, token string) int {
	if err := http.ListenAndServe(addr, tunnel.Handler(token)); err != nil {
		fmt.Println(err)
		return 1
	}
	return 0
}

func doctor(base string) int {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(base + "/health")
	if err != nil {
		fmt.Println("unreachable:", err)
		return 1
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	fmt.Printf("health %d %s\n", resp.StatusCode, strings.TrimSpace(string(body)))
	if resp.StatusCode >= 400 {
		return 1
	}
	return 0
}

func getJSON(url, token string) int {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		fmt.Println(err)
		return 1
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		fmt.Println(err)
		return 1
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	fmt.Println(string(body))
	if resp.StatusCode >= 400 {
		return 1
	}
	return 0
}

func chat(base, token, model, prompt string) int {
	raw, _ := json.Marshal(map[string]any{
		"model": model,
		"messages": []any{map[string]any{
			"role": "user", "content": prompt,
		}},
	})
	req, err := http.NewRequest(http.MethodPost, base+"/v1/chat/completions", bytes.NewReader(raw))
	if err != nil {
		fmt.Println(err)
		return 1
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		fmt.Println(err)
		return 1
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	fmt.Println(string(body))
	if resp.StatusCode >= 400 {
		return 1
	}
	return 0
}
