import http from 'node:http';
import { Readable } from 'node:stream';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ROUTER_API_KEY = process.env.ROUTER_API_KEY || '';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function getBearer(req) {
  const value = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(value);
  return m?.[1] || '';
}

function isAuthorized(req) {
  if (!ROUTER_API_KEY) return true; // local-dev mode only
  return getBearer(req) === ROUTER_API_KEY;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function copyUpstreamHeaders(upstream, res) {
  const allowed = [
    'content-type',
    'cache-control',
    'openai-request-id',
    'x-request-id',
    'retry-after',
  ];
  for (const name of allowed) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  // Streaming endpoints should not be buffered by reverse proxies.
  res.setHeader('x-accel-buffering', 'no');
}

async function proxyResponses(req, res) {
  if (!OPENAI_API_KEY) {
    return json(res, 500, {
      error: {
        type: 'router_configuration_error',
        message: 'OPENAI_API_KEY is not configured on the router.',
      },
    });
  }

  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch (error) {
    return json(res, error.status || 400, {
      error: { type: 'invalid_request_error', message: error.message },
    });
  }

  // Validate JSON, but intentionally do not transform it. This preserves the
  // Responses wire format, including input items, tools, function_call,
  // function_call_output, and stream=true.
  try {
    JSON.parse(rawBody.toString('utf8'));
  } catch {
    return json(res, 400, {
      error: { type: 'invalid_request_error', message: 'Body must be valid JSON.' },
    });
  }

  const controller = new AbortController();
  req.once('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM_BASE_URL}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json',
        accept: req.headers.accept || '*/*',
        ...(req.headers['openai-organization']
          ? { 'openai-organization': req.headers['openai-organization'] }
          : {}),
        ...(req.headers['openai-project']
          ? { 'openai-project': req.headers['openai-project'] }
          : {}),
      },
      body: rawBody,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    return json(res, 502, {
      error: { type: 'upstream_connection_error', message: String(error?.message || error) },
    });
  }

  res.statusCode = upstream.status;
  copyUpstreamHeaders(upstream, res);

  if (!upstream.body) {
    res.end();
    return;
  }

  // Byte-stream pass-through. If upstream is SSE, all Responses API event
  // names/data are preserved as emitted by the upstream provider.
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on('error', (error) => {
    if (!res.headersSent) {
      json(res, 502, { error: { type: 'stream_error', message: error.message } });
    } else {
      res.destroy(error);
    }
  });
  nodeStream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'codex-responses-router',
      upstream: UPSTREAM_BASE_URL,
    });
  }

  if (req.method === 'POST' && req.url === '/v1/responses') {
    if (!isAuthorized(req)) {
      res.setHeader('www-authenticate', 'Bearer');
      return json(res, 401, {
        error: { type: 'authentication_error', message: 'Invalid router bearer token.' },
      });
    }
    return proxyResponses(req, res);
  }

  return json(res, 404, {
    error: { type: 'not_found', message: 'Use POST /v1/responses.' },
  });
});

server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;

server.listen(PORT, HOST, () => {
  console.log(`Responses router listening on http://${HOST}:${PORT}`);
  console.log(`Upstream: ${UPSTREAM_BASE_URL}`);
  console.log(`Router auth: ${ROUTER_API_KEY ? 'enabled' : 'disabled (local dev only)'}`);
});
