// Local capture sink for the debug-panel recorder.
//
// The browser cannot write to a directory on its own, and a kiosk install must
// not be asked to pick one. So the dev/preview server owns the directory and
// the page just posts blobs at it: one HTTP POST per MediaRecorder chunk,
// appended in order to a single .webm per take. Appending is what makes this
// crash-safe — a machine pulled from the wall still leaves a playable file up
// to the last chunk.
import fs from "node:fs";
import path from "node:path";

const ROUTE = "/__recordings";
const SAFE_NAME = /^[A-Za-z0-9._-]+\.webm$/;

export function recorderPlugin({ dir = "recordings" } = {}) {
  let root = process.cwd();

  const middleware = (req, res, next) => {
    if (!req.url?.startsWith(`${ROUTE}/`)) return next();

    const url = new URL(req.url, "http://localhost");
    const target = path.resolve(root, dir);

    if (url.pathname === `${ROUTE}/status`) return json(res, 200, { dir: target });

    if (url.pathname !== `${ROUTE}/append` || req.method !== "POST") {
      return json(res, 404, { error: "unknown recording route" });
    }

    const name = url.searchParams.get("file") ?? "";
    // Path traversal is the only real hazard here: the name comes off a query
    // string and is joined onto a directory.
    if (!SAFE_NAME.test(name)) return json(res, 400, { error: `bad file name: ${name}` });

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("error", () => json(res, 500, { error: "upload failed" }));
    req.on("end", () => {
      try {
        fs.mkdirSync(target, { recursive: true });
        const file = path.join(target, name);
        fs.appendFileSync(file, Buffer.concat(chunks));
        json(res, 200, { file, bytes: fs.statSync(file).size });
      } catch (error) {
        json(res, 500, { error: String(error?.message ?? error) });
      }
    });
  };

  return {
    name: "unconscious-layers-recorder",
    configResolved(config) {
      root = config.root ?? root;
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    // Same sink under `npm run preview`, so the built app records too.
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
