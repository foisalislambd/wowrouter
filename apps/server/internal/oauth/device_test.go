package oauth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeviceStartAndPending(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if hits == 1 {
			_, _ = w.Write([]byte(`{"device_code":"dev","user_code":"ABCD","verification_uri":"https://example.com/device","interval":1}`))
			return
		}
		_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
	}))
	defer srv.Close()
	prevDevice, prevToken := DeviceEndpoint, TokenEndpoint
	DeviceEndpoint = srv.URL
	TokenEndpoint = srv.URL
	defer func() {
		DeviceEndpoint = prevDevice
		TokenEndpoint = prevToken
	}()
	code, err := StartDevice(t.Context(), "kiro", srv.Client())
	if err != nil || code.UserCode != "ABCD" {
		t.Fatalf("%v %#v", err, code)
	}
	_, pending, err := PollDevice(t.Context(), "kiro", code.DeviceCode, srv.Client())
	if err != nil || pending != "authorization_pending" {
		t.Fatalf("%s %v", pending, err)
	}
}
