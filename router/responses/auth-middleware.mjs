import crypto from "node:crypto";

import {
  backendUnavailable,
  unauthorized
} from "./error-mapper.mjs";

function safeEqual(left, right) {
  const a =
    Buffer.from(left);

  const b =
    Buffer.from(right);

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}

export function assertBearerAuth(
  req,
  {
    apiKey =
      process.env.ROUTER_API_KEY
  } = {}
) {
  if (
    typeof apiKey !== "string" ||
    apiKey.length === 0
  ) {
    throw backendUnavailable(
      "ROUTER_API_KEY is not configured for the Responses compatibility layer.",
      "router_api_key_not_configured"
    );
  }

  const authorization =
    req.headers?.authorization;

  if (
    typeof authorization !==
      "string"
  ) {
    throw unauthorized(
      "Authorization header is missing."
    );
  }

  const match =
    /^Bearer\s+(.+)$/i.exec(
      authorization.trim()
    );

  if (
    !match ||
    !safeEqual(
      match[1],
      apiKey
    )
  ) {
    throw unauthorized();
  }
}
