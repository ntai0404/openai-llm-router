export class RouterError extends Error {
  constructor(message, { status = 500, type = "internal_error", code = "internal_error", param = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RouterError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = param;
  }
}

export function invalidRequest(message, param = null, code = "invalid_request") {
  return new RouterError(message, {
    status: 400,
    type: "invalid_request_error",
    code,
    param
  });
}

export function unsupportedContentType(message = "Content-Type must be application/json.") {
  return new RouterError(message, {
    status: 415,
    type: "invalid_request_error",
    code: "unsupported_content_type",
    param: null
  });
}

export function unauthorized(message = "Invalid or missing bearer token.") {
  return new RouterError(message, {
    status: 401,
    type: "authentication_error",
    code: "invalid_api_key",
    param: null
  });
}

export function backendUnavailable(message = "Execution backend is unavailable.", code = "backend_unavailable") {
  return new RouterError(message, {
    status: 503,
    type: "backend_unavailable",
    code,
    param: null
  });
}

export function requestTimeout(message = "The request timed out.") {
  return new RouterError(message, {
    status: 504,
    type: "request_timeout",
    code: "request_timeout",
    param: null
  });
}

export function malformedStructuredOutput(message = "Structured model output failed validation.") {
  return new RouterError(message, {
    status: 502,
    type: "malformed_structured_output",
    code: "malformed_structured_output",
    param: null
  });
}

export function internalError(message = "Internal server error.", cause) {
  return new RouterError(message, {
    status: 500,
    type: "internal_error",
    code: "internal_error",
    param: null,
    cause
  });
}

export function mapError(error) {
  const mapped =
    error instanceof RouterError
      ? error
      : internalError("Internal server error.", error);

  const headers = {
    "content-type": "application/json; charset=utf-8"
  };

  if (mapped.status === 401) {
    headers["www-authenticate"] = "Bearer";
  }

  return {
    status: mapped.status,
    headers,
    body: {
      error: {
        message: mapped.message,
        type: mapped.type,
        param: mapped.param,
        code: mapped.code
      }
    }
  };
}
