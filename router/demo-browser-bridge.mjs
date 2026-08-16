import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { handleResponsesRoute } from "./responses/responses-router.mjs";

try { process.loadEnvFile?.(); } catch {}

const HOST = "127.0.0.1";
const PORT = 8788;
const RUN_TIMEOUT_MS = 300000;

const jobs = new Map();

let extensionSocket = null;
let activeJobId = null;

function json(res, status, value) {
  const body = JSON.stringify(value);

  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "content-type,x-router-job-token",
    "access-control-allow-methods":
      "GET,POST,OPTIONS"
  });

  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 10 * 1024 * 1024) {
      throw new Error("Body too large.");
    }

    chunks.push(chunk);
  }

  const raw =
    Buffer.concat(chunks).toString("utf8");

  return raw ? JSON.parse(raw) : {};
}

function extractText(input) {
  if (typeof input === "string") {
    return input.trim();
  }

  if (!Array.isArray(input)) {
    return "";
  }

  const parts = [];

  for (const item of input) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }

    if (!item) continue;

    if (typeof item.content === "string") {
      parts.push(item.content);
      continue;
    }

    if (Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content === "string") {
          parts.push(content);
        } else if (
          content &&
          typeof content.text === "string"
        ) {
          parts.push(content.text);
        }
      }
    }
  }

  return parts.join("\n").trim();
}

function createJob(prompt) {
  const id = crypto.randomUUID();

  const token =
    crypto.randomBytes(24).toString("hex");

  const job = {
    id,
    token,
    prompt,
    status: "queued",
    createdAt: Date.now(),
    dispatchedAt: null,
    sentAt: null,
    completedAt: null,
    response: null,
    error: null
  };

  jobs.set(id, job);

  dispatchNext();

  return job;
}

function queuedJobs() {
  return [...jobs.values()]
    .filter(job => job.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt);
}

function dispatchNext() {
  if (
    activeJobId ||
    !extensionSocket ||
    extensionSocket.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const job = queuedJobs()[0];

  if (!job) return;

  activeJobId = job.id;
  job.status = "dispatched";
  job.dispatchedAt = Date.now();

  try {
    extensionSocket.send(
      JSON.stringify({
        type: "job",
        job: {
          id: job.id,
          token: job.token,
          prompt: job.prompt
        }
      })
    );
  } catch (error) {
    job.status = "queued";
    job.dispatchedAt = null;
    activeJobId = null;

    console.error(
      "Unable to dispatch job:",
      error
    );
  }
}

function releaseJob(job) {
  if (activeJobId === job.id) {
    activeJobId = null;
  }

  queueMicrotask(dispatchNext);
}

function authorized(req, job) {
  return (
    job &&
    req.headers["x-router-job-token"] ===
      job.token
  );
}

async function waitForJob(
  job,
  timeoutMs = RUN_TIMEOUT_MS
) {
  const started = Date.now();

  while (
    Date.now() - started < timeoutMs
  ) {
    if (
      job.status === "completed" ||
      job.status === "error"
    ) {
      return job;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 250)
    );
  }

  if (
    job.status !== "completed" &&
    job.status !== "error"
  ) {
    job.status = "error";
    job.error =
      `Timed out after ${timeoutMs}ms`;

    releaseJob(job);
  }

  return job;
}

async function parsePrompt(req) {
  const body = await readJson(req);

  return extractText(
    body.input ?? body.prompt
  );
}

setInterval(() => {
  const cutoff =
    Date.now() - 30 * 60 * 1000;

  for (const [id, job] of jobs) {
    if (
      job.createdAt < cutoff &&
      id !== activeJobId
    ) {
      jobs.delete(id);
    }
  }
}, 60000).unref();

const server =
  http.createServer(
    async (req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers":
            "content-type,x-router-job-token",
          "access-control-allow-methods":
            "GET,POST,OPTIONS"
        });

        return res.end();
      }

      if (
        await handleResponsesRoute(
          req,
          res
        )
      ) {
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/health"
      ) {
        return json(res, 200, {
          ok: true,
          service:
            "chatgpt-browser-demo-bridge",
          port: PORT,
          extension_connected:
            !!extensionSocket &&
            extensionSocket.readyState ===
              WebSocket.OPEN,
          worker_busy: !!activeJobId,
          active_job_id: activeJobId,
          queued_jobs:
            queuedJobs().length
        });
      }

      if (
        req.method === "POST" &&
        (
          req.url === "/demo/run" ||
          req.url === "/browser/run"
        )
      ) {
        const isBrowserRun =
          req.url === "/browser/run";

        let body;
        let prompt;

        try {
          body = await readJson(req);

          prompt = extractText(
            body.input ?? body.prompt
          );
        } catch (error) {
          return json(res, 400, {
            ...(isBrowserRun
              ? {}
              : { ok: false }),
            error: error.message
          });
        }

        if (!prompt) {
          return json(res, 400, {
            ...(isBrowserRun
              ? {}
              : { ok: false }),
            error: "Prompt is required."
          });
        }

        let timeoutMs =
          RUN_TIMEOUT_MS;

        const requestedTimeout =
          Number(body.timeout_ms);

        if (
          Number.isFinite(
            requestedTimeout
          )
        ) {
          timeoutMs = Math.max(
            1000,
            Math.min(
              RUN_TIMEOUT_MS,
              Math.trunc(
                requestedTimeout
              )
            )
          );
        }

        const job =
          createJob(prompt);

        await waitForJob(
          job,
          timeoutMs
        );

        if (
          job.status === "completed"
        ) {
          if (isBrowserRun) {
            return json(res, 200, {
              id: job.id,
              status: "completed",
              output_text:
                job.response
            });
          }

          return json(res, 200, {
            ok: true,
            job_id: job.id,
            status: "completed",
            output_text:
              job.response
          });
        }

        if (isBrowserRun) {
          return json(res, 504, {
            id: job.id,
            status: job.status,
            error: job.error
          });
        }

        return json(res, 504, {
          ok: false,
          job_id: job.id,
          status: job.status,
          error: job.error
        });
      }

      if (
        req.method === "POST" &&
        req.url === "/demo/submit"
      ) {
        let prompt;

        try {
          prompt =
            await parsePrompt(req);
        } catch (error) {
          return json(res, 400, {
            ok: false,
            error: error.message
          });
        }

        if (!prompt) {
          return json(res, 400, {
            ok: false,
            error: "Prompt is required."
          });
        }

        const job =
          createJob(prompt);

        return json(res, 202, {
          ok: true,
          job_id: job.id,
          status: job.status,
          status_url:
            `/demo/status/${job.id}`
        });
      }

      let match =
        /^\/demo\/status\/([0-9a-f-]+)$/.exec(
          req.url || ""
        );

      if (
        req.method === "GET" &&
        match
      ) {
        const job =
          jobs.get(match[1]);

        if (!job) {
          return json(res, 404, {
            ok: false,
            error: "Job not found."
          });
        }

        return json(res, 200, {
          ok: true,
          job_id: job.id,
          status: job.status,
          response: job.response,
          error: job.error,
          queued_jobs:
            queuedJobs().length
        });
      }

      match =
        /^\/internal\/jobs\/([0-9a-f-]+)\/sent$/.exec(
          req.url || ""
        );

      if (
        req.method === "POST" &&
        match
      ) {
        const job =
          jobs.get(match[1]);

        if (!authorized(req, job)) {
          return json(res, 404, {
            ok: false,
            error: "Job not found."
          });
        }

        job.status =
          "waiting_response";

        job.sentAt =
          Date.now();

        return json(res, 200, {
          ok: true,
          status: job.status
        });
      }

      match =
        /^\/internal\/jobs\/([0-9a-f-]+)\/result$/.exec(
          req.url || ""
        );

      if (
        req.method === "POST" &&
        match
      ) {
        const job =
          jobs.get(match[1]);

        if (!authorized(req, job)) {
          return json(res, 404, {
            ok: false,
            error: "Job not found."
          });
        }

        let body;

        try {
          body =
            await readJson(req);
        } catch (error) {
          return json(res, 400, {
            ok: false,
            error: error.message
          });
        }

        if (
          typeof body.response !==
            "string" ||
          !body.response.trim()
        ) {
          return json(res, 400, {
            ok: false,
            error:
              "Response text is required."
          });
        }

        job.response =
          body.response;

        job.status =
          "completed";

        job.completedAt =
          Date.now();

        releaseJob(job);

        console.log(
          `Completed ${job.id} (${job.response.length} chars)`
        );

        return json(res, 200, {
          ok: true,
          job_id: job.id,
          status: "completed"
        });
      }

      match =
        /^\/internal\/jobs\/([0-9a-f-]+)\/error$/.exec(
          req.url || ""
        );

      if (
        req.method === "POST" &&
        match
      ) {
        const job =
          jobs.get(match[1]);

        if (!authorized(req, job)) {
          return json(res, 404, {
            ok: false,
            error: "Job not found."
          });
        }

        let body = {};

        try {
          body =
            await readJson(req);
        } catch {}

        job.status = "error";

        job.error =
          String(
            body.error ||
            "Browser worker failed."
          );

        releaseJob(job);

        return json(res, 200, {
          ok: true,
          status: "error"
        });
      }

      return json(res, 404, {
        ok: false,
        error: "Not found."
      });
    }
  );

const wss =
  new WebSocketServer({
    server,
    path: "/extension"
  });

wss.on(
  "connection",
  (socket, request) => {
    const origin =
      request.headers.origin || "";

    if (
      origin &&
      !origin.startsWith(
        "chrome-extension://"
      )
    ) {
      socket.close(
        1008,
        "Extension only"
      );

      return;
    }

    if (
      extensionSocket &&
      extensionSocket !== socket
    ) {
      try {
        extensionSocket.close();
      } catch {}
    }

    extensionSocket = socket;

    console.log(
      "Chrome extension connected"
    );

    socket.on(
      "message",
      data => {
        let message;

        try {
          message =
            JSON.parse(
              data.toString()
            );
        } catch {
          return;
        }

        if (
          message.type ===
          "keepalive"
        ) {
          try {
            socket.send(
              JSON.stringify({
                type: "keepalive_ack",
                time: Date.now()
              })
            );
          } catch {}
        }
      }
    );

    socket.on(
      "close",
      () => {
        if (
          extensionSocket === socket
        ) {
          extensionSocket = null;
        }

        if (activeJobId) {
          const job =
            jobs.get(activeJobId);

          if (
            job &&
            ![
              "completed",
              "error"
            ].includes(job.status)
          ) {
            job.status =
              "queued";

            job.dispatchedAt =
              null;
          }

          activeJobId = null;
        }

        console.log(
          "Chrome extension disconnected"
        );
      }
    );

    dispatchNext();
  }
);

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `Browser bridge: http://${HOST}:${PORT}`
    );

    console.log(
      `Extension socket: ws://${HOST}:${PORT}/extension`
    );
  }
);
