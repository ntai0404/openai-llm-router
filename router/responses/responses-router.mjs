import {
  assertBearerAuth
} from "./auth-middleware.mjs";

import {
  executeNormalizedRequest
} from "./execution-adapter.mjs";

import {
  mapError,
  invalidRequest,
  unsupportedContentType
} from "./error-mapper.mjs";

import {
  normalizeResponsesRequest
} from "./request-normalizer.mjs";

import {
  encodeCompletedResponse
} from "./response-encoder.mjs";

const MAX_BODY_BYTES =
  10 * 1024 * 1024;

function writeJson(
  res,
  status,
  body,
  extraHeaders = {}
) {
  const encoded =
    JSON.stringify(body);

  res.writeHead(
    status,
    {
      "content-type":
        "application/json; charset=utf-8",

      "content-length":
        Buffer.byteLength(
          encoded
        ),

      "access-control-allow-origin":
        "*",

      ...extraHeaders
    }
  );

  res.end(encoded);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (
    const chunk of req
  ) {
    size += chunk.length;

    if (
      size >
      MAX_BODY_BYTES
    ) {
      throw invalidRequest(
        "Request body is too large.",
        null,
        "request_too_large"
      );
    }

    chunks.push(chunk);
  }

  const text =
    Buffer.concat(chunks)
      .toString("utf8");

  if (!text) {
    throw invalidRequest(
      "Request body is required.",
      null
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw invalidRequest(
      "Request body must contain valid JSON.",
      null,
      "invalid_json"
    );
  }
}

function isJsonContentType(req) {
  const value =
    req.headers?.[
      "content-type"
    ];

  if (
    typeof value !==
      "string"
  ) {
    return false;
  }

  return value
    .split(";", 1)[0]
    .trim()
    .toLowerCase() ===
    "application/json";
}

export async function handleResponsesRoute(
  req,
  res,
  {
    apiKey =
      process.env
        .ROUTER_API_KEY,

    execute =
      executeNormalizedRequest
  } = {}
) {
  const pathname =
    new URL(
      req.url || "/",
      "http://127.0.0.1"
    ).pathname;

  if (
    pathname !==
    "/v1/responses"
  ) {
    /*
      Returning false is intentional:
      legacy bridge routes continue
      through their existing handler.
    */
    return false;
  }

  try {
    if (
      req.method !== "POST"
    ) {
      throw invalidRequest(
        "Only POST is supported for /v1/responses.",
        null,
        "method_not_allowed"
      );
    }

    assertBearerAuth(
      req,
      { apiKey }
    );

    if (
      !isJsonContentType(req)
    ) {
      throw unsupportedContentType();
    }

    const body =
      await readJson(req);

    const normalized =
      normalizeResponsesRequest(
        body
      );

    /*
      Phase 1 is intentionally
      non-stream only.
      Phase 2 will replace this with
      the SSE encoder.
    */
    if (normalized.stream) {
      throw invalidRequest(
        "stream=true is reserved for Phase 2 and is not enabled yet.",
        "stream",
        "streaming_not_implemented"
      );
    }

    const executionResult =
      await execute(
        normalized
      );

    const response =
      encodeCompletedResponse(
        normalized,
        executionResult
      );

    writeJson(
      res,
      200,
      response
    );
  } catch (error) {
    const mapped =
      mapError(error);

    writeJson(
      res,
      mapped.status,
      mapped.body,
      mapped.headers
    );
  }

  return true;
}
