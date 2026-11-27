// Dev server only (`apply: "serve"`): receives the feedback overlay's bundle and writes it where
// agents can read it, `<os temp>/zomfy-feedback/<timestamp>/` (docs/specs/dev-feedback-overlay.md).
import type { IncomingMessage } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import {
  FEEDBACK_ENDPOINT,
  buildFeedbackMarkdown,
  buildFeedbackSummary,
  bundleFolderName,
  withRepoPaths,
  type FeedbackRequest,
  type FeedbackResponse,
} from "./src/dev/feedback/bundle";

export function feedbackBaseDir(): string {
  return process.env.ZOMFY_FEEDBACK_DIR ?? join(tmpdir(), "zomfy-feedback");
}

export async function writeFeedbackBundle(
  request: FeedbackRequest,
  options: { baseDir: string; viteRoot: string; repoRoot: string; now?: Date },
): Promise<FeedbackResponse> {
  const match = /^data:image\/png;base64,(.+)$/s.exec(request.screenshot);
  if (!match) throw new Error("The screenshot is not a PNG data URL.");
  const dir = join(options.baseDir, bundleFolderName(options.now ?? new Date()));
  await mkdir(dir, { recursive: true });
  const payload = withRepoPaths(request.payload, options.viteRoot, options.repoRoot);
  await Promise.all([
    writeFile(join(dir, "screenshot.png"), Buffer.from(match[1]!, "base64")),
    writeFile(join(dir, "feedback.json"), `${JSON.stringify({ ...payload, screenshot: "screenshot.png" }, null, 2)}\n`),
    writeFile(join(dir, "feedback.md"), buildFeedbackMarkdown(payload, dir)),
  ]);
  return { dir, summary: buildFeedbackSummary(payload, dir) };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function devFeedback(): Plugin {
  let viteRoot = process.cwd();
  return {
    name: "zomfy-dev-feedback",
    apply: "serve",
    configResolved(config) {
      viteRoot = config.root;
    },
    configureServer(server) {
      server.middlewares.use(FEEDBACK_ENDPOINT, (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        void (async () => {
          try {
            const request = JSON.parse(await readBody(req)) as FeedbackRequest;
            const response = await writeFeedbackBundle(request, { baseDir: feedbackBaseDir(), viteRoot, repoRoot: resolve(viteRoot, "..", "..") });
            server.config.logger.info(`feedback saved to ${response.dir}`, { timestamp: true });
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(response));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        })();
      });
    },
  };
}
