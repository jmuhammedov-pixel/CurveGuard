import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const HOST =
  process.env.HOST ||
  "127.0.0.1";

const PORT =
  Number.parseInt(
    process.env.PORT ||
    "8787",
    10
  );

const ROOT =
  process.cwd();

const PUBLIC =
  path.join(
    ROOT,
    "public"
  );

const REPORTS =
  path.join(
    ROOT,
    "reports"
  );

const RUNS =
  path.join(
    REPORTS,
    "runs"
  );

const UPLOADS =
  path.join(
    REPORTS,
    "web-uploads"
  );

fs.mkdirSync(
  UPLOADS,
  {
    recursive: true
  }
);

function send(
  res,
  status,
  body,
  contentType =
    "text/plain; charset=utf-8"
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        contentType,

      "Cache-Control":
        "no-store"
    }
  );

  res.end(body);
}

function json(
  res,
  status,
  data
) {
  send(
    res,
    status,
    JSON.stringify(data),
    "application/json; charset=utf-8"
  );
}

function safeName(name) {
  return String(
    name ||
    "dbc_config.jsonc"
  )
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    )
    .slice(0, 100);
}

function readBody(
  req,
  maxBytes =
    2 * 1024 * 1024
) {
  return new Promise(
    (resolve, reject) => {

      const chunks = [];

      let size = 0;

      req.on(
        "data",
        chunk => {

          size +=
            chunk.length;

          if (
            size >
            maxBytes
          ) {
            reject(
              new Error(
                "Upload exceeds 2 MB limit."
              )
            );

            req.destroy();

            return;
          }

          chunks.push(
            chunk
          );
        }
      );

      req.on(
        "end",
        () => {
          resolve(
            Buffer.concat(
              chunks
            )
          );
        }
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

function serveFile(
  res,
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    send(
      res,
      404,
      "Not found"
    );

    return;
  }

  const ext =
    path.extname(
      filePath
    )
      .toLowerCase();

  const types = {
    ".html":
      "text/html; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".js":
      "text/javascript; charset=utf-8",

    ".css":
      "text/css; charset=utf-8"
  };

  const type =
    types[ext] ||
    "application/octet-stream";

  send(
    res,
    200,
    fs.readFileSync(
      filePath
    ),
    type
  );
}

function extractDashboard(
  text
) {
  const line =
    text
      .split(/\r?\n/)
      .find(
        x =>
          x.startsWith(
            "CURVEGUARD_DASHBOARD="
          )
      );

  if (!line) {
    return null;
  }

  return line.substring(
    "CURVEGUARD_DASHBOARD="
      .length
  );
}

function runAnalyzer(
  configPath
) {
  return new Promise(
    resolve => {

      const child =
        spawn(
          process.execPath,
          [
            path.join(
              ROOT,
              "src",
              "analyze.js"
            ),
            configPath
          ],
          {
            cwd:
              ROOT,

            windowsHide:
              true
          }
        );

      let stdout = "";
      let stderr = "";

      child.stdout.on(
        "data",
        chunk => {
          stdout +=
            chunk.toString();
        }
      );

      child.stderr.on(
        "data",
        chunk => {
          stderr +=
            chunk.toString();
        }
      );

      child.on(
        "close",
        code => {

          resolve({
            code,
            stdout,
            stderr
          });
        }
      );
    }
  );
}

function dashboardToUrl(
  dashboardPath
) {
  if (
    !dashboardPath
  ) {
    return null;
  }

  const absolute =
    path.resolve(
      dashboardPath
    );

  const runsRoot =
    path.resolve(
      RUNS
    );

  if (
    !absolute.startsWith(
      runsRoot +
      path.sep
    )
  ) {
    return null;
  }

  const relative =
    path.relative(
      runsRoot,
      absolute
    )
      .split(
        path.sep
      )
      .join("/");

  return (
    "/runs/" +
    encodeURI(relative)
  );
}

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      const url =
        new URL(
          req.url,
          `http://${HOST}:${PORT}`
        );

      /*
       * HOME UI
       */
      if (
        req.method === "GET" &&
        url.pathname === "/"
      ) {
        serveFile(
          res,
          path.join(
            PUBLIC,
            "index.html"
          )
        );

        return;
      }

      /*
       * SERVE DEMO CONFIGS
       */
      if (
        req.method === "GET" &&
        url.pathname.startsWith(
          "/demos/"
        )
      ) {
        const relative =
          decodeURIComponent(
            url.pathname.substring(
              "/demos/".length
            )
          );

        const demosRoot =
          path.resolve(
            PUBLIC,
            "demos"
          );

        const requested =
          path.resolve(
            demosRoot,
            relative
          );

        if (
          !requested.startsWith(
            demosRoot +
            path.sep
          )
        ) {
          send(
            res,
            403,
            "Forbidden"
          );

          return;
        }

        serveFile(
          res,
          requested
        );

        return;
      }

      /*
       * SERVE GENERATED REPORTS
       */
      if (
        req.method === "GET" &&
        url.pathname.startsWith(
          "/runs/"
        )
      ) {
        const relative =
          decodeURIComponent(
            url.pathname
              .substring(
                "/runs/".length
              )
          );

        const requested =
          path.resolve(
            RUNS,
            relative
          );

        const runsRoot =
          path.resolve(
            RUNS
          );

        if (
          !requested.startsWith(
            runsRoot +
            path.sep
          )
        ) {
          send(
            res,
            403,
            "Forbidden"
          );

          return;
        }

        serveFile(
          res,
          requested
        );

        return;
      }

      /*
       * API ANALYZE
       */
      if (
        req.method === "POST" &&
        url.pathname ===
          "/api/analyze"
      ) {
        try {

          const body =
            await readBody(req);

          const request =
            JSON.parse(
              body.toString(
                "utf8"
              )
            );

          const content =
            String(
              request.content ||
              ""
            );

          if (
            !content.trim()
          ) {
            json(
              res,
              400,
              {
                ok: false,
                error:
                  "Config file is empty."
              }
            );

            return;
          }

          const filename =
            safeName(
              request.filename
            );

          const uploadId =
            new Date()
              .toISOString()
              .replace(
                /[:.]/g,
                "-"
              ) +
            "-" +
            crypto
              .randomBytes(4)
              .toString("hex");

          const uploadDir =
            path.join(
              UPLOADS,
              uploadId
            );

          fs.mkdirSync(
            uploadDir,
            {
              recursive: true
            }
          );

          const configPath =
            path.join(
              uploadDir,
              filename
            );

          fs.writeFileSync(
            configPath,
            content,
            "utf8"
          );

          const result =
            await runAnalyzer(
              configPath
            );

          const combined =
            result.stdout +
            "\n" +
            result.stderr;

          const dashboardPath =
            extractDashboard(
              combined
            );

          const dashboardUrl =
            dashboardToUrl(
              dashboardPath
            );

          if (
            result.code !== 0 ||
            !dashboardUrl
          ) {
            json(
              res,
              400,
              {
                ok: false,

                error:
                  "CurveGuard analysis failed.",

                log:
                  combined
                    .split(/\r?\n/)
                    .filter(Boolean)
                    .slice(-30)
                    .join("\n")
              }
            );

            return;
          }

          json(
            res,
            200,
            {
              ok: true,

              dashboardUrl,

              message:
                "Analysis completed successfully."
            }
          );

        } catch (err) {

          json(
            res,
            500,
            {
              ok: false,

              error:
                err?.message ||
                String(err)
            }
          );
        }

        return;
      }

      if (
        req.method === "GET" &&
        url.pathname ===
          "/api/health"
      ) {
        json(
          res,
          200,
          {
            ok: true,
            product:
              "CurveGuard Competition Edition"
          }
        );

        return;
      }

      send(
        res,
        404,
        "Not found"
      );
    }
  );

server.listen(
  PORT,
  HOST,
  () => {

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      " CURVEGUARD COMPETITION EDITION WEB UI"
    );

    console.log(
      "=========================================="
    );

    console.log("");

    if (
      HOST === "127.0.0.1" ||
      HOST === "localhost"
    ) {
      console.log(
        `Open: http://${HOST}:${PORT}`
      );

      console.log("");
      console.log(
        "Local development mode."
      );
    } else {
      console.log(
        `Listening on ${HOST}:${PORT}`
      );

      console.log("");
      console.log(
        "Cloud deployment mode."
      );
    }

    console.log(
      "No wallet or transaction permissions."
    );

    console.log("");
    console.log(
      "Press Ctrl+C to stop."
    );
  }
);