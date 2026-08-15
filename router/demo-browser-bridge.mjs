import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 8788;
const RUN_TIMEOUT_MS = 180000;
const jobs = new Map();

function json(res, status, value) {
  const body = JSON.stringify(value);

  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-router-job-token",
    "access-control-allow-methods": "GET,POST,OPTIONS"
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

  const raw = Buffer.concat(chunks).toString("utf8");
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

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES &&
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["PROGRAMFILES(X86)"] &&
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA &&
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
  ].filter(Boolean);

  return candidates.find(path => fs.existsSync(path));
}

function launchChrome(url) {
  const chrome = findChrome();

  if (!chrome) {
    throw new Error("Chrome executable not found.");
  }

  const child = spawn(
    chrome,
    [url],
    {
      detached: true,
      stdio: "ignore"
    }
  );

  child.unref();
}

function authorized(req, job) {
  return (
    job &&
    req.headers["x-router-job-token"] === job.token
  );
}

function createJob(prompt) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString("hex");

  const job = {
    id,
    token,
    prompt,
    status: "queued",
    createdAt: Date.now(),
    sentAt: null,
    completedAt: null,
    response: null,
    error: null
  };

  jobs.set(id, job);

  const url =
    "https://chatgpt.com/?" +
    new URLSearchParams({
      "temporary-chat": "true",
      "router-demo": "1",
      "router-job": id,
      "router-token": token
    }).toString();

  try {
    launchChrome(url);
    job.status = "browser_opened";
  } catch (error) {
    job.status = "error";
    job.error = error.message;
  }

  return job;
}

async function waitForJob(job, timeoutMs = RUN_TIMEOUT_MS) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (job.status === "completed") {
      return job;
    }

    if (job.status === "error") {
      return job;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 250)
    );
  }

  job.status = "error";
  job.error = `Timed out after ${timeoutMs}ms`;

  return job;
}

async function parsePrompt(req) {
  const body = await readJson(req);
  return extractText(body.input ?? body.prompt);
}

setInterval(() => {
  const cutoff =
    Date.now() - 30 * 60 * 1000;

  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
    }
  }
}, 60000).unref();

const server =
  http.createServer(async (req, res) => {
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
      req.method === "GET" &&
      req.url === "/health"
    ) {
      return json(res, 200, {
        ok: true,
        service: "chatgpt-browser-demo-bridge",
        port: PORT
      });
    }

    /*
      One-request synchronous demo endpoint.

      POST /demo/run
      {"input":"Hello"}

      Waits until the browser job completes and then
      returns the captured output.
    */
    if (
      req.method === "POST" &&
      req.url === "/demo/run"
    ) {
      let prompt;

      try {
        prompt = await parsePrompt(req);
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

      const job = createJob(prompt);

      if (job.status === "error") {
        return json(res, 500, {
          ok: false,
          job_id: job.id,
          status: job.status,
          error: job.error
        });
      }

      await waitForJob(job);

      if (job.status === "completed") {
        return json(res, 200, {
          ok: true,
          job_id: job.id,
          status: "completed",
          output_text: job.response
        });
      }

      return json(res, 504, {
        ok: false,
        job_id: job.id,
        status: job.status,
        error: job.error
      });
    }

    /*
      Existing asynchronous endpoint.
    */
    if (
      req.method === "POST" &&
      req.url === "/demo/submit"
    ) {
      let prompt;

      try {
        prompt = await parsePrompt(req);
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

      const job = createJob(prompt);

      if (job.status === "error") {
        return json(res, 500, {
          ok: false,
          job_id: job.id,
          error: job.error
        });
      }

      return json(res, 202, {
        ok: true,
        job_id: job.id,
        status: job.status,
        status_url: `/demo/status/${job.id}`
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
      const job = jobs.get(match[1]);

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
        created_at: job.createdAt,
        sent_at: job.sentAt,
        completed_at: job.completedAt
      });
    }

    match =
      /^\/demo\/result\/([0-9a-f-]+)$/.exec(
        req.url || ""
      );

    if (
      req.method === "GET" &&
      match
    ) {
      const job = jobs.get(match[1]);

      if (!job) {
        return json(res, 404, {
          ok: false,
          error: "Job not found."
        });
      }

      if (job.status !== "completed") {
        return json(res, 202, {
          ok: true,
          job_id: job.id,
          status: job.status,
          error: job.error
        });
      }

      return json(res, 200, {
        ok: true,
        job_id: job.id,
        status: "completed",
        response: job.response
      });
    }

    match =
      /^\/internal\/jobs\/([0-9a-f-]+)$/.exec(
        req.url || ""
      );

    if (
      req.method === "GET" &&
      match
    ) {
      const job = jobs.get(match[1]);

      if (!authorized(req, job)) {
        return json(res, 404, {
          ok: false,
          error: "Job not found."
        });
      }

      return json(res, 200, {
        ok: true,
        job_id: job.id,
        prompt: job.prompt,
        status: job.status
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
      const job = jobs.get(match[1]);

      if (!authorized(req, job)) {
        return json(res, 404, {
          ok: false,
          error: "Job not found."
        });
      }

      job.status = "waiting_response";
      job.sentAt = Date.now();

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
      const job = jobs.get(match[1]);

      if (!authorized(req, job)) {
        return json(res, 404, {
          ok: false,
          error: "Job not found."
        });
      }

      let body;

      try {
        body = await readJson(req);
      } catch (error) {
        return json(res, 400, {
          ok: false,
          error: error.message
        });
      }

      if (
        typeof body.response !== "string" ||
        !body.response.trim()
      ) {
        return json(res, 400, {
          ok: false,
          error: "Response text is required."
        });
      }

      job.response = body.response;
      job.status = "completed";
      job.completedAt = Date.now();

      console.log(
        `Job ${job.id} completed (${job.response.length} chars)`
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
      const job = jobs.get(match[1]);

      if (!authorized(req, job)) {
        return json(res, 404, {
          ok: false,
          error: "Job not found."
        });
      }

      let body = {};

      try {
        body = await readJson(req);
      } catch {}

      job.status = "error";
      job.error =
        String(
          body.error ||
          "Browser automation failed."
        );

      return json(res, 200, {
        ok: true,
        status: "error"
      });
    }

    return json(res, 404, {
      ok: false,
      error: "Not found."
    });
  });

server.listen(PORT, HOST, () => {
  console.log(
    `Browser bridge: http://${HOST}:${PORT}`
  );

  console.log(
    "POST /demo/run     synchronous"
  );

  console.log(
    "POST /demo/submit  asynchronous"
  );
});
