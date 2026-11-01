package main

import "fmt"

// chatMessage is the user text on every simple-chat request. It stays fixed so
// each run sends the same bytes.
const chatMessage = "Reply with one short word. The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump. The five boxing wizards jump quickly. Sphinx of black quartz, judge my vow. Two driven jocks help fax my big quiz. The jay, pig, fox, zebra and my wolves quack. "

func chatBody(model string, stream bool) []byte {
	flag := "false"
	if stream {
		flag = "true"
	}
	return []byte(fmt.Sprintf(
		`{"model":%q,"max_tokens":256,"stream":%s,"messages":[{"role":"user","content":%q}]}`,
		model, flag, chatMessage,
	))
}
