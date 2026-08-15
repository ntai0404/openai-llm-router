import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 8788;
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

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw) return {};

  return JSON.parse(raw);
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
    if (!item) continue;

    if (typeof item === "string") {
      parts.push(item);
      continue;
    }

    if (typeof item.content === "string") {
      parts.push(item.content);
      continue;
    }

    if (Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content === "string") {
          parts.push(content);
          continue;
        }

        if (
          content &&
          typeof content.text === "string" &&
          (
            !content.type ||
            content.type === "input_text" ||
            content.type === "text"
          )
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
    throw new Error(
      "Chrome executable not found. Set CHROME_PATH to chrome.exe."
    );
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

function validJobToken(req, job) {
  return (
    job &&
    req.headers["x-router-job-token"] === job.token
  );
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
    }
  }
}, 60_000).unref();

const server = http.createServer(async (req, res) => {
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

  if (
    req.method === "POST" &&
    req.url === "/demo/submit"
  ) {
    let body;

    try {
      body = await readJson(req);
    } catch {
      return json(res, 400, {
        ok: false,
        error: "Body must be valid JSON."
      });
    }

    const prompt =
      extractText(body.input ?? body.prompt);

    if (!prompt) {
      return json(res, 400, {
        ok: false,
        error:
          'Provide {"input":"your prompt"}'
      });
    }

    const id = crypto.randomUUID();

    const token =
      crypto.randomBytes(24).toString("hex");

    jobs.set(id, {
      id,
      token,
      prompt,
      status: "queued",
      createdAt: Date.now()
    });

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
    } catch (error) {
      jobs.delete(id);

      return json(res, 500, {
        ok: false,
        error: error.message
      });
    }

    jobs.get(id).status = "browser_opened";

    return json(res, 202, {
      ok: true,
      job_id: id,
      status: "browser_opened"
    });
  }

  const getMatch =
    /^\/internal\/jobs\/([0-9a-f-]+)$/.exec(
      req.url || ""
    );

  if (
    req.method === "GET" &&
    getMatch
  ) {
    const job = jobs.get(getMatch[1]);

    if (!validJobToken(req, job)) {
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

  const sentMatch =
    /^\/internal\/jobs\/([0-9a-f-]+)\/sent$/.exec(
      req.url || ""
    );

  if (
    req.method === "POST" &&
    sentMatch
  ) {
    const job = jobs.get(sentMatch[1]);

    if (!validJobToken(req, job)) {
      return json(res, 404, {
        ok: false,
        error: "Job not found."
      });
    }

    job.status = "sent";
    job.sentAt = Date.now();

    return json(res, 200, {
      ok: true,
      job_id: job.id,
      status: job.status
    });
  }

  return json(res, 404, {
    ok: false,
    error: "Not found."
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `Browser demo bridge listening on http://${HOST}:${PORT}`
  );

  console.log(
    'POST /demo/submit  {"input":"your prompt"}'
  );
});
