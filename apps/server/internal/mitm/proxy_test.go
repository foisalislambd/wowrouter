package mitm

import "testing"

func TestProxyRefusesPublicBind(t *testing.T) {
	var p Proxy
	if err := p.Start("0.0.0.0:1"); err == nil {
		t.Fatal("public bind accepted")
	}
	pem, err := p.CA()
	if err != nil || len(pem) == 0 {
		t.Fatal(err)
	}
	if p.Running() {
		t.Fatal("proxy should stay off")
	}
}
