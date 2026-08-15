# Codex Responses Router + ChatGPT Auto Temporary Extension

This project intentionally separates two responsibilities:

1. `router/`: a self-hosted, Codex-compatible **OpenAI Responses API** pass-through using the official API as upstream.
2. `chrome-extension/`: a Manifest V3 browser helper that **best-effort auto-enables Temporary Chat** when a new ChatGPT web conversation opens.

It does **not** turn the ChatGPT web application or a ChatGPT subscription into an API backend, and does not scrape web-chat answers for API clients.

## 1) Router

Requirements: Node.js 20+.

```bash
cd router
cp .env.example .env
# edit .env and set OPENAI_API_KEY + ROUTER_API_KEY
npm run check
npm start
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Non-streaming Responses request:

```bash
curl http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $CODEX_ROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.6-terra","input":"Say hello in Vietnamese."}'
```

Streaming request (SSE is passed through unchanged):

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $CODEX_ROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.6-terra","input":"Count from 1 to 5.","stream":true}'
```

Because the request JSON is not transformed, standard Responses API items such as `input`, `tools`, `function_call`, and `function_call_output` pass through to the upstream API. For `stream:true`, the router streams upstream SSE bytes/events back to the caller.

### Codex configuration

Copy/merge `codex/config.toml.example` into `~/.codex/config.toml`, then set:

```bash
export CODEX_ROUTER_API_KEY='same-value-as-ROUTER_API_KEY'
```

The important provider settings are (replace the example model with one available to your API project):

```toml
base_url = "http://127.0.0.1:8787/v1"
env_key = "CODEX_ROUTER_API_KEY"
wire_api = "responses"
```

### Exposing the router remotely

If deployed to a VPS/container, bind behind HTTPS (Caddy/Nginx/Cloudflare Tunnel, etc.), use a strong `ROUTER_API_KEY`, and keep `OPENAI_API_KEY` server-side only. Do not expose this example directly to the public internet over plain HTTP.

## 2) Chrome extension: automatically enable Temporary Chat

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `chrome-extension/` directory.
5. Open ChatGPT and start a new chat.

The extension is enabled by default. Its popup can disable/re-enable the behavior.

### Important limitation

ChatGPT's web DOM is not a stable public extension API. The script therefore uses accessibility text/role heuristics instead of private API calls. If OpenAI changes the menu labels/DOM, `content.js` may need a selector/label update.

## Security notes

- Never place `OPENAI_API_KEY` in the Chrome extension.
- `ROUTER_API_KEY` authenticates clients to your router; it should be different from the OpenAI key.
- The router intentionally forwards only `/v1/responses`; it is not an unrestricted open proxy.
- Keep the router on localhost unless you add TLS, access controls, and appropriate logging/rate limits.
