// Package mitm is an opt-in loopback TLS proxy. It does not install a CA
// into the system trust store. The operator downloads the certificate and
// trusts it themselves. The proxy stays off until Start is called.
package mitm

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Proxy is the local intercept listener.
type Proxy struct {
	mu       sync.Mutex
	certPEM  []byte
	keyPEM   []byte
	server   *http.Server
	listener net.Listener
}

// CA returns the certificate PEM, generating it on first use.
func (p *Proxy) CA() ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureCA(); err != nil {
		return nil, err
	}
	return append([]byte(nil), p.certPEM...), nil
}

func (p *Proxy) ensureCA() error {
	if len(p.certPEM) > 0 {
		return nil
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "WowRouter Local Proxy"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	p.certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return err
	}
	p.keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return nil
}

// Running reports whether the proxy is accepting connections.
func (p *Proxy) Running() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.listener != nil
}

// Start listens on a loopback address. It refuses any other host.
// CONNECT is terminated with a certificate signed by this proxy's CA.
// The CA is not installed into the operating system.
func (p *Proxy) Start(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return errors.New("the proxy only listens on a loopback address")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.listener != nil {
		return nil
	}
	if err := p.ensureCA(); err != nil {
		return err
	}
	cert, err := tls.X509KeyPair(p.certPEM, p.keyPEM)
	if err != nil {
		return err
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	p.listener = ln
	_ = cert
	p.server = &http.Server{
		Handler:           http.HandlerFunc(p.serve),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() { _ = p.server.Serve(ln) }()
	return nil
}

func (p *Proxy) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodConnect {
		http.Error(w, "this proxy only accepts CONNECT", http.StatusMethodNotAllowed)
		return
	}
	host := r.Host
	if !strings.Contains(host, ":") {
		host += ":443"
	}
	up, err := tls.Dial("tcp", host, &tls.Config{MinVersion: tls.VersionTLS12})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer up.Close()
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijack is not available", http.StatusInternalServerError)
		return
	}
	client, _, err := hj.Hijack()
	if err != nil {
		return
	}
	defer client.Close()
	if _, err := io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	leaf, err := p.leaf(host)
	if err != nil {
		return
	}
	tlsClient := tls.Server(client, &tls.Config{Certificates: []tls.Certificate{leaf}, MinVersion: tls.VersionTLS12})
	if err := tlsClient.Handshake(); err != nil {
		return
	}
	defer tlsClient.Close()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(tlsClient, up); done <- struct{}{} }()
	go func() { _, _ = io.Copy(up, tlsClient); done <- struct{}{} }()
	<-done
}

func (p *Proxy) leaf(host string) (tls.Certificate, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureCA(); err != nil {
		return tls.Certificate{}, err
	}
	ca, err := tls.X509KeyPair(p.certPEM, p.keyPEM)
	if err != nil {
		return tls.Certificate{}, err
	}
	caCert, err := x509.ParseCertificate(ca.Certificate[0])
	if err != nil {
		return tls.Certificate{}, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	name := strings.Split(host, ":")[0]
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		DNSNames:     []string{name},
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &key.PublicKey, ca.PrivateKey)
	if err != nil {
		return tls.Certificate{}, err
	}
	return tls.Certificate{Certificate: [][]byte{der, ca.Certificate[0]}, PrivateKey: key}, nil
}

// Stop closes the listener.
func (p *Proxy) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.server != nil {
		_ = p.server.Close()
	}
	p.listener = nil
	p.server = nil
}
