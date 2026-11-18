/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  AR_OBJECTS: R2Bucket;
  TRIPO_API_KEY: string;
  OPERATOR_MONITOR_KEY: string;
  ARCHIVE_ACCESS_KEY: string;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type MuseJobStatus = "waiting" | "image" | "model" | "complete" | "error";
type MuseJob = {
  id: string;
  status: MuseJobStatus;
  name: string;
  collection: string;
  objects: string[];
  placements?: Array<{ id: string; normal: [number, number, number] }>;
  effects: string[];
  strength: number;
  imageTaskId?: string;
  tripoTaskId?: string;
  arUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const MUSE_OBJECT_IDS = new Set([
  "cloud", "metal", "sand", "stone", "light", "ice", "chrome", "moss", "wood", "cocoon", "water",
  "flower", "leaf", "branch", "mushroom", "fruit", "fabric", "crystal", "feather", "ribbon", "lily", "rose",
]);
const OBJECT_MODEL_REVISION = "photo-pbr-v2";
const objectModelKey = (id: string) => `object-models/${OBJECT_MODEL_REVISION}/${id}.glb`;
const objectModelTaskKey = (id: string) => `object-models/${OBJECT_MODEL_REVISION}/${id}.json`;
const objectModelUrl = (id: string) => `/api/object-models/${id}/model?v=${OBJECT_MODEL_REVISION}`;

const museJobKey = (id: string) => `jobs/${id}.json`;
const museJobSilhouetteKey = (id: string) => `jobs/${id}.png`;
const ARCHIVE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ARCHIVE_MAX_ATTEMPTS = 5;

async function checkArchiveAccess(request: Request, env: Env): Promise<Response | null> {
  const headers = { "Cache-Control": "private, no-store" };
  if (!env.ARCHIVE_ACCESS_KEY) {
    return Response.json({ error: "보관함 접근 키가 설정되지 않았습니다." }, { status: 503, headers });
  }
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS archive_access_attempts (client_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL)").run();
    const address = request.headers.get("CF-Connecting-IP") || "unknown";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
    const clientId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const now = Date.now();
    const entry = await env.DB.prepare("SELECT attempts, window_start AS windowStart FROM archive_access_attempts WHERE client_id = ?")
      .bind(clientId).first<{ attempts: number; windowStart: number }>();
    if (entry && now - entry.windowStart < ARCHIVE_ATTEMPT_WINDOW_MS && entry.attempts >= ARCHIVE_MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((ARCHIVE_ATTEMPT_WINDOW_MS - (now - entry.windowStart)) / 1000);
      return Response.json({ error: "시도가 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
    }
    if (request.headers.get("X-Muse-Operator-Key") === env.ARCHIVE_ACCESS_KEY) {
      if (entry) await env.DB.prepare("DELETE FROM archive_access_attempts WHERE client_id = ?").bind(clientId).run();
      return null;
    }
    if (!entry || now - entry.windowStart >= ARCHIVE_ATTEMPT_WINDOW_MS) {
      await env.DB.prepare("INSERT INTO archive_access_attempts (client_id, attempts, window_start) VALUES (?, 1, ?) ON CONFLICT(client_id) DO UPDATE SET attempts = 1, window_start = excluded.window_start")
        .bind(clientId, now).run();
    } else {
      await env.DB.prepare("UPDATE archive_access_attempts SET attempts = attempts + 1 WHERE client_id = ?").bind(clientId).run();
    }
    return Response.json({ error: "운영자 접근 키를 확인해주세요." }, { status: 401, headers });
  } catch (error) {
    console.error("Failed to validate archive access", error);
    return Response.json({ error: "보관함 인증에 연결할 수 없습니다." }, { status: 503, headers });
  }
}

async function readMuseJob(env: Env, id: string) {
  const object = await env.AR_OBJECTS.get(museJobKey(id));
  return object ? await object.json() as MuseJob : null;
}

async function writeMuseJob(env: Env, job: MuseJob) {
  await env.AR_OBJECTS.put(museJobKey(job.id), JSON.stringify(job), {
    httpMetadata: { contentType: "application/json" },
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate-world" && request.method === "POST") {
      const body = await request.clone().json().catch(() => null) as { jobId?: string } | null;
      if (body?.jobId && /^[a-f0-9]{32}$/.test(body.jobId)) {
        const job = await readMuseJob(env, body.jobId);
        if (!job) return Response.json({ error: "제작 작업을 찾지 못했습니다." }, { status: 404 });
        if (job.imageTaskId) return Response.json({ taskId: job.imageTaskId, status: "in_progress" }, { status: 202 });
        const silhouette = await env.AR_OBJECTS.get(museJobSilhouetteKey(job.id));
        if (!silhouette) return Response.json({ error: "조형 정보를 찾지 못했습니다." }, { status: 404 });
        const bytes = new Uint8Array(await silhouette.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 32768) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
        }
        const generated = await handler.fetch(new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ silhouette: `data:image/png;base64,${btoa(binary)}`, objects: job.objects, placements: job.placements }),
        }), env, ctx);
        const result = await generated.clone().json().catch(() => null) as { taskId?: string } | null;
        if (generated.ok && result?.taskId) {
          job.imageTaskId = result.taskId;
          job.status = "image";
          job.updatedAt = Date.now();
          await writeMuseJob(env, job);
        }
        return generated;
      }
      return handler.fetch(request, env, ctx);
    }

    if (url.pathname === "/api/muse-jobs" && request.method === "POST") {
      try {
        const body = await request.json() as {
          silhouette?: string;
          name?: string;
          collection?: string;
          objects?: string[];
          placements?: Array<{ id: string; normal: [number, number, number] }>;
          effects?: string[];
          strength?: number;
        };
        const match = body.silhouette?.match(/^data:image\/png;base64,(.+)$/);
        if (!match) return Response.json({ error: "조형 이미지를 준비하지 못했습니다." }, { status: 400 });
        const binary = atob(match[1]);
        if (binary.length > 8 * 1024 * 1024) return Response.json({ error: "조형 이미지가 너무 큽니다." }, { status: 413 });
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const id = crypto.randomUUID().replaceAll("-", "");
        const now = Date.now();
        const job: MuseJob = {
          id,
          status: "waiting",
          name: (body.name?.trim() || "GUEST").slice(0, 20),
          collection: (body.collection?.trim() || "Make your Muse").slice(0, 80),
          objects: (body.objects ?? []).filter((value) => typeof value === "string").slice(0, 22),
          placements: Array.isArray(body.placements) ? body.placements.filter((placement) =>
            placement && typeof placement.id === "string" && MUSE_OBJECT_IDS.has(placement.id)
            && Array.isArray(placement.normal) && placement.normal.length === 3
            && placement.normal.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1.01),
          ).slice(0, 4) : [],
          effects: (body.effects ?? []).filter((value) => typeof value === "string").slice(0, 22),
          strength: Math.max(0, Math.min(1, Number(body.strength) || 0)),
          createdAt: now,
          updatedAt: now,
        };
        await env.AR_OBJECTS.put(museJobSilhouetteKey(id), bytes, { httpMetadata: { contentType: "image/png" } });
        await writeMuseJob(env, job);
        return Response.json({ id, url: `${url.origin}/?job=${id}` });
      } catch (error) {
        console.error("Failed to create MUSE phone job", error);
        return Response.json({ error: "휴대폰 제작 링크를 만들지 못했습니다." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/operator/archive-access" && request.method === "GET") {
      const denied = await checkArchiveAccess(request, env);
      if (denied) return denied;
      return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
    }

    if (url.pathname === "/api/operator/balance" && request.method === "GET") {
      if (!env.OPERATOR_MONITOR_KEY || request.headers.get("X-Muse-Operator-Key") !== env.OPERATOR_MONITOR_KEY) return Response.json({ error: "운영자 접근 키를 확인해주세요." }, { status: 401 });
      try {
        if (!env.TRIPO_API_KEY) throw new Error("Tripo API 키가 설정되지 않았습니다.");
        const response = await fetch("https://openapi.tripo3d.ai/v3/account/balance", {
          headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` }, signal: AbortSignal.timeout(8000),
        });
        const wallet = await response.json() as { code?: number; data?: { balance?: number; frozen?: number } };
        if (!response.ok || wallet.code !== 0 || typeof wallet.data?.balance !== "number" || !Number.isFinite(wallet.data.balance)) throw new Error(response.status === 401 ? "Tripo API 키 인증을 확인해주세요." : "Tripo 잔액을 확인하지 못했습니다.");
        return Response.json({ balance: wallet.data.balance, frozen: wallet.data.frozen ?? 0, required: 30, checkedAt: Date.now() }, { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Tripo 잔액 연결을 확인해주세요." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
    }

    if (url.pathname === "/api/operator/muse-jobs" && request.method === "GET") {
      const suppliedKey = request.headers.get("X-Muse-Operator-Key") ?? url.searchParams.get("key") ?? "";
      if (!env.OPERATOR_MONITOR_KEY || suppliedKey !== env.OPERATOR_MONITOR_KEY) {
        return Response.json({ error: "운영자 접근 키를 확인해주세요." }, { status: 401 });
      }
      try {
        const objects: R2Object[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 4; page += 1) {
          const listed = await env.AR_OBJECTS.list({ prefix: "jobs/", limit: 1000, cursor });
          objects.push(...listed.objects.filter((object) => object.key.endsWith(".json")));
          if (!listed.truncated || !listed.cursor) break;
          cursor = listed.cursor;
        }
        const jobs = (await Promise.all(objects.map(async (object) => {
          try { return await readMuseJob(env, object.key.slice(5, -5)); }
          catch { return null; }
        })))
          .filter((job): job is MuseJob => Boolean(job))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 80)
          .map((job) => ({
            id: job.id,
            name: job.name,
            collection: job.collection,
            objects: job.objects,
            status: job.status,
            error: job.error,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          }));
        return Response.json({ jobs, checkedAt: Date.now() }, {
          headers: { "Cache-Control": "private, no-store" },
        });
      } catch (error) {
        console.error("Failed to read operator MUSE jobs", error);
        return Response.json({ error: "운영자 상태를 불러오지 못했습니다." }, { status: 500 });
      }
    }

    const museJobMatch = url.pathname.match(/^\/api\/muse-jobs\/([a-f0-9]{32})$/);
    if (museJobMatch && request.method === "GET") {
      const job = await readMuseJob(env, museJobMatch[1]);
      if (!job) return Response.json({ error: "제작 작업을 찾지 못했습니다." }, { status: 404 });
      const { error: _operatorError, ...visitorJob } = job;
      return Response.json({ job: visitorJob });
    }

    if (museJobMatch && request.method === "PATCH") {
      try {
        const job = await readMuseJob(env, museJobMatch[1]);
        if (!job) return Response.json({ error: "제작 작업을 찾지 못했습니다." }, { status: 404 });
        const body = await request.json() as Omit<Partial<Pick<MuseJob, "status" | "imageTaskId" | "tripoTaskId" | "arUrl" | "error">>, "imageTaskId" | "tripoTaskId"> & { imageTaskId?: string | null; tripoTaskId?: string | null };
        const allowedStatuses = new Set<MuseJobStatus>(["waiting", "image", "model", "complete", "error"]);
        if (body.status && allowedStatuses.has(body.status)) job.status = body.status;
        if (body.imageTaskId === null || body.imageTaskId === "") delete job.imageTaskId;
        else if (typeof body.imageTaskId === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(body.imageTaskId)) job.imageTaskId = body.imageTaskId;
        if (body.tripoTaskId === null || body.tripoTaskId === "") delete job.tripoTaskId;
        else if (typeof body.tripoTaskId === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(body.tripoTaskId)) job.tripoTaskId = body.tripoTaskId;
        if (typeof body.arUrl === "string" && body.arUrl.length <= 600) job.arUrl = body.arUrl;
        if (typeof body.error === "string") job.error = body.error.slice(0, 300);
        if (job.status !== "error") delete job.error;
        job.updatedAt = Date.now();
        await writeMuseJob(env, job);
        if (job.status === "complete") await env.AR_OBJECTS.delete(museJobSilhouetteKey(job.id));
        return Response.json({ job });
      } catch (error) {
        console.error("Failed to update MUSE phone job", error);
        return Response.json({ error: "휴대폰 제작 상태를 저장하지 못했습니다." }, { status: 500 });
      }
    }

    const museJobSilhouetteMatch = url.pathname.match(/^\/api\/muse-jobs\/([a-f0-9]{32})\/silhouette$/);
    if (museJobSilhouetteMatch && request.method === "GET") {
      const object = await env.AR_OBJECTS.get(museJobSilhouetteKey(museJobSilhouetteMatch[1]));
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
    }

    if (url.pathname === "/api/auras" && request.method === "POST") {
      try {
        const body = await request.json() as { image?: string; name?: string; arUrl?: string; objects?: string[]; jobId?: string; tripoTaskId?: string };
        const match = body.image?.match(/^data:image\/png;base64,(.+)$/);
        if ((!match && !body.tripoTaskId) || !body.arUrl) return Response.json({ error: "저장할 AURA가 없습니다." }, { status: 400 });
        if (body.jobId && !/^[a-f0-9]{32}$/.test(body.jobId)) return Response.json({ error: "저장할 작업을 찾지 못했습니다." }, { status: 400 });
        let sourceJob: MuseJob | null = null;
        if (body.jobId) {
          const job = await readMuseJob(env, body.jobId);
          if (!job) return Response.json({ error: "저장할 작업을 찾지 못했습니다." }, { status: 404 });
          sourceJob = job;
          const saved = await env.DB.prepare("SELECT id FROM auras WHERE id = ?").bind(body.jobId).first<{ id: string }>();
          if (saved) return Response.json({ id: saved.id, saved: true });
        }
        let bytes: Uint8Array;
        if (body.tripoTaskId && sourceJob?.tripoTaskId === body.tripoTaskId) {
          const preview = await env.AR_OBJECTS.get(`tripo/${body.tripoTaskId}.png`);
          if (!preview) return Response.json({ error: "완성 이미지를 찾지 못했습니다." }, { status: 404 });
          bytes = new Uint8Array(await preview.arrayBuffer());
        } else if (match) {
          const binary = atob(match[1]);
          if (binary.length > 8 * 1024 * 1024) return Response.json({ error: "AURA 이미지가 너무 큽니다." }, { status: 413 });
          bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        } else {
          return Response.json({ error: "저장할 작업을 찾지 못했습니다." }, { status: 400 });
        }
        if (bytes.byteLength > 8 * 1024 * 1024) return Response.json({ error: "AURA 이미지가 너무 큽니다." }, { status: 413 });
        const id = body.jobId ?? crypto.randomUUID().replaceAll("-", "");
        const imageKey = `gallery/${id}.png`;
        await env.AR_OBJECTS.put(imageKey, bytes, { httpMetadata: { contentType: "image/png" } });
        await env.DB.prepare(`INSERT OR IGNORE INTO auras (id, collection, image_key, ar_url, objects, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(id, (body.name?.trim() || "GUEST").slice(0, 20), imageKey, body.arUrl.slice(0, 500), JSON.stringify((body.objects ?? []).slice(0, 22)), Date.now())
          .run();
        return Response.json({ id });
      } catch {
        return Response.json({ error: "AURA를 저장하지 못했습니다." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/auras" && request.method === "GET") {
      const rows = await env.DB.prepare(`SELECT id, CASE WHEN collection IN ('HARVEST', 'HARVEST PERFUME SOAP COLLECTION', 'BLUE HINOKI', 'COCOON', 'THE COCOON COLLECTION', 'BOTTARI', 'SUNSHINE', 'SHOWERY BODY', 'SHOWERYBODY COLLECTION — DAY DREAM', 'EVENING GLOW', 'SUMMER TAILS') THEN 'GUEST' ELSE collection END AS name, ar_url AS arUrl, objects, created_at AS createdAt FROM auras ORDER BY created_at DESC LIMIT 60`).all();
      return Response.json({ auras: rows.results }, { headers: { "Cache-Control": "no-store" } });
    }

    const auraImageMatch = url.pathname.match(/^\/api\/auras\/([a-f0-9]{32})\/image$/);
    if (auraImageMatch && request.method === "GET") {
      const object = await env.AR_OBJECTS.get(`gallery/${auraImageMatch[1]}.png`);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers({ "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
      return new Response(object.body, { headers });
    }

    const auraRecordMatch = url.pathname.match(/^\/api\/auras\/([a-f0-9]{32})$/);
    if (auraRecordMatch && request.method === "PATCH") {
      const denied = await checkArchiveAccess(request, env);
      if (denied) return denied;
      try {
        const body = await request.json() as { name?: unknown };
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || [...name].length > 20 || /[\u0000-\u001f]/.test(name)) {
          return Response.json({ error: "이름은 1~20자로 입력해주세요." }, { status: 400 });
        }
        const savedAura = await env.DB.prepare("SELECT id FROM auras WHERE id = ?")
          .bind(auraRecordMatch[1]).first<{ id: string }>();
        if (!savedAura) return Response.json({ error: "이름을 바꿀 MUSE를 찾지 못했습니다." }, { status: 404 });
        await env.DB.prepare("UPDATE auras SET collection = ? WHERE id = ?")
          .bind(name, auraRecordMatch[1]).run();
        return Response.json({ name }, { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) {
        console.error("Failed to rename saved MUSE", error);
        return Response.json({ error: "저장된 MUSE 이름을 바꾸지 못했습니다." }, { status: 500 });
      }
    }

    if (auraRecordMatch && request.method === "DELETE") {
      const denied = await checkArchiveAccess(request, env);
      if (denied) return denied;
      try {
        const id = auraRecordMatch[1];
        const savedAura = await env.DB.prepare(`SELECT image_key AS imageKey, ar_url AS arUrl FROM auras WHERE id = ?`)
          .bind(id)
          .first<{ imageKey: string; arUrl: string }>();
        if (!savedAura) return Response.json({ error: "삭제할 MUSE를 찾지 못했습니다." }, { status: 404 });

        const storedUrl = new URL(savedAura.arUrl, request.url);
        const modelId = storedUrl.searchParams.get("model") ?? storedUrl.searchParams.get("ar");
        const keys = [savedAura.imageKey];
        if (modelId && /^[a-f0-9]{32}$/.test(modelId)) {
          keys.push(`ar/${modelId}.glb`, `ar/${modelId}.png`, `ar/${modelId}.json`);
        }
        const cleanup = await Promise.allSettled(keys.map((key) => env.AR_OBJECTS.delete(key)));
        cleanup.forEach((result, index) => {
          if (result.status === "rejected") console.error("Failed to delete stored MUSE asset", keys[index], result.reason);
        });
        await env.DB.prepare(`DELETE FROM auras WHERE id = ?`).bind(id).run();
        return Response.json({ deleted: true });
      } catch (error) {
        console.error("Failed to delete saved MUSE", error);
        return Response.json({ error: "저장된 MUSE를 삭제하지 못했습니다." }, { status: 500 });
      }
    }

    const objectModelMatch = url.pathname.match(/^\/api\/object-models\/([a-z]+)$/);
    if (objectModelMatch && request.method === "POST") {
      const suppliedKey = request.headers.get("X-Muse-Operator-Key") ?? url.searchParams.get("key") ?? "";
      if (!env.OPERATOR_MONITOR_KEY || suppliedKey !== env.OPERATOR_MONITOR_KEY) {
        return Response.json({ error: "운영자만 3D 오브젝트를 준비할 수 있습니다." }, { status: 401 });
      }
      const id = objectModelMatch[1];
      if (!MUSE_OBJECT_IDS.has(id)) return Response.json({ error: "오브젝트를 찾지 못했습니다." }, { status: 404 });
      if (await env.AR_OBJECTS.head(objectModelKey(id))) {
        return Response.json({ status: "ready", modelUrl: objectModelUrl(id) });
      }
      const existing = await env.AR_OBJECTS.get(objectModelTaskKey(id));
      if (existing) {
        const task = await existing.json() as { taskId?: string; status?: string };
        if (task.taskId && task.status !== "error") return Response.json({ status: "processing" });
        if (task.status === "error") await env.AR_OBJECTS.delete(objectModelTaskKey(id));
      }
      try {
        if (!env.TRIPO_API_KEY) return Response.json({ error: "3D 오브젝트 준비를 시작하지 못했습니다." }, { status: 503 });
        const imageResponse = await env.ASSETS.fetch(new Request(new URL(`/objects/${id}.png`, request.url)));
        if (!imageResponse.ok) return Response.json({ error: "오브젝트 이미지를 찾지 못했습니다." }, { status: 404 });
        const imageBytes = await imageResponse.arrayBuffer();
        const form = new FormData();
        form.append("file", new Blob([imageBytes], { type: imageResponse.headers.get("content-type") || "image/png" }), `${id}.png`);
        const uploadResponse = await fetch("https://openapi.tripo3d.ai/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` },
          body: form,
        });
        const uploaded = await uploadResponse.json() as { code?: number; data?: { file_token?: string }; message?: string };
        if (!uploadResponse.ok || uploaded.code !== 0 || !uploaded.data?.file_token) {
          throw new Error(uploaded.message || "object upload failed");
        }
        const generationResponse = await fetch("https://openapi.tripo3d.ai/v3/generation/image-to-model", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            input: uploaded.data.file_token,
            model: "v3.1-20260211",
            texture: true,
            pbr: true,
            texture_quality: "extreme",
            texture_alignment: "original_image",
            enable_image_autofix: true,
            orientation: "align_image",
            compress: "geometry",
          }),
        });
        const generated = await generationResponse.json() as { code?: number; data?: { task_id?: string }; message?: string };
        if (!generationResponse.ok || generated.code !== 0 || !generated.data?.task_id) {
          const creditError = /credit|balance/i.test(generated.message || "");
          if (creditError) return Response.json({ error: "Tripo 크레딧이 부족해 사전 3D 생성을 시작하지 못했습니다." }, { status: 503 });
          throw new Error(generated.message || "object generation failed");
        }
        await env.AR_OBJECTS.put(objectModelTaskKey(id), JSON.stringify({ taskId: generated.data.task_id, status: "processing", updatedAt: Date.now() }), {
          httpMetadata: { contentType: "application/json" },
        });
        return Response.json({ status: "processing" }, { status: 202 });
      } catch (error) {
        console.error("Failed to start Tripo object model", id, error);
        return Response.json({ error: "3D 오브젝트 준비를 시작하지 못했습니다." }, { status: 502 });
      }
    }

    if (objectModelMatch && request.method === "GET") {
      const id = objectModelMatch[1];
      if (!MUSE_OBJECT_IDS.has(id)) return Response.json({ error: "오브젝트를 찾지 못했습니다." }, { status: 404 });
      if (await env.AR_OBJECTS.head(objectModelKey(id))) {
        return Response.json({ status: "ready", modelUrl: objectModelUrl(id) }, { headers: { "Cache-Control": "public, max-age=300" } });
      }
      const metadataObject = await env.AR_OBJECTS.get(objectModelTaskKey(id));
      if (!metadataObject) return Response.json({ status: "missing" });
      const metadata = await metadataObject.json() as { taskId?: string; status?: string; updatedAt?: number };
      if (metadata.status === "error" || !metadata.taskId) return Response.json({ status: "error" });
      try {
        const taskResponse = await fetch(`https://openapi.tripo3d.ai/v3/tasks/${metadata.taskId}`, {
          headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` },
        });
        const task = await taskResponse.json() as {
          code?: number;
          data?: {
            status?: string;
            output?: { pbr_model?: string; pbr_model_url?: string; model_url?: string; model?: string; base_model?: string };
          };
          message?: string;
        };
        if (!taskResponse.ok || task.code !== 0) throw new Error(task.message || "object task query failed");
        const status = task.data?.status ?? "running";
        const modelUrl = task.data?.output?.pbr_model
          ?? task.data?.output?.pbr_model_url
          ?? task.data?.output?.model_url
          ?? task.data?.output?.model
          ?? task.data?.output?.base_model;
        if (status === "success" && modelUrl) {
          const modelResponse = await fetch(modelUrl);
          if (!modelResponse.ok) throw new Error(`object model download returned ${modelResponse.status}`);
          await env.AR_OBJECTS.put(objectModelKey(id), await modelResponse.arrayBuffer(), {
            httpMetadata: { contentType: "model/gltf-binary" },
          });
          await env.AR_OBJECTS.delete(objectModelTaskKey(id));
          return Response.json({ status: "ready", modelUrl: objectModelUrl(id) });
        }
        if (["failed", "cancelled", "banned", "expired"].includes(status)) {
          await env.AR_OBJECTS.put(objectModelTaskKey(id), JSON.stringify({ ...metadata, status: "error", updatedAt: Date.now() }), {
            httpMetadata: { contentType: "application/json" },
          });
          return Response.json({ status: "error" });
        }
        return Response.json({ status: "processing" });
      } catch (error) {
        console.warn("Tripo object model is not ready yet", id, error);
        return Response.json({ status: "processing" });
      }
    }

    const objectModelFileMatch = url.pathname.match(/^\/api\/object-models\/([a-z]+)\/model$/);
    if (objectModelFileMatch && request.method === "GET") {
      if (!MUSE_OBJECT_IDS.has(objectModelFileMatch[1])) return new Response("Not found", { status: 404 });
      const object = await env.AR_OBJECTS.get(objectModelKey(objectModelFileMatch[1]));
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, { headers: { "Content-Type": "model/gltf-binary", "Cache-Control": "public, max-age=31536000, immutable" } });
    }

    if (url.pathname === "/api/tripo-model" && request.method === "POST") {
      try {
        if (!env.TRIPO_API_KEY) return Response.json({ error: "Tripo API 키가 설정되지 않았습니다." }, { status: 503 });
        const body = await request.json() as {
          image?: string;
          views?: Partial<Record<"front" | "left" | "back" | "right", string>>;
          jobId?: string;
          collection?: string;
          effects?: string[];
          strength?: number;
        };
        const sourceJob = body.jobId && /^[a-f0-9]{32}$/.test(body.jobId) ? await readMuseJob(env, body.jobId) : null;
        if (body.jobId && !sourceJob) return Response.json({ error: "제작 작업을 찾지 못했습니다." }, { status: 404 });
        if (sourceJob?.tripoTaskId) return Response.json({ taskId: sourceJob.tripoTaskId });
        // The front view doubles as the saved preview. This avoids sending the
        // full 2x2 source sheet in addition to all four cropped views.
        const previewImage = body.views?.front ?? body.image;
        const match = previewImage?.match(/^data:image\/png;base64,(.+)$/);
        if (!match) return Response.json({ error: "3D로 변환할 이미지가 없습니다." }, { status: 400 });
        const binary = atob(match[1]);
        if (binary.length > 20 * 1024 * 1024) return Response.json({ error: "이미지 용량이 너무 큽니다." }, { status: 413 });
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

        const viewOrder = ["front", "left", "back", "right"] as const;
        const hasMultiview = viewOrder.every((view) => body.views?.[view]?.startsWith("data:image/png;base64,"));
        if (!hasMultiview) {
          return Response.json({ error: "앞·왼쪽·뒤·오른쪽 이미지가 모두 필요합니다. 4면 이미지를 다시 생성해주세요." }, { status: 400 });
        }
        const requiredCredits = 30;
        const balanceResponse = await fetch("https://openapi.tripo3d.ai/v3/account/balance", {
          headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` },
        });
        const wallet = await balanceResponse.json() as { code?: number; data?: { balance?: number; frozen?: number } };
        if (balanceResponse.status === 401) {
          return Response.json({ error: "Tripo API 키가 만료되었거나 올바르지 않습니다." }, { status: 503 });
        }
        if (balanceResponse.ok && wallet.code === 0 && Number(wallet.data?.balance) < requiredCredits) {
          return Response.json({
            error: `Tripo API 사용 가능 크레딧이 부족합니다. 4면 텍스처 3D 생성에는 ${requiredCredits} 크레딧이 필요합니다. Tripo Studio가 아닌 API 지갑을 충전해주세요.`,
          }, { status: 402 });
        }
        const uploadImage = async (dataUrl: string, filename: string) => {
          const imageMatch = dataUrl.match(/^data:image\/png;base64,(.+)$/);
          if (!imageMatch) throw new Error("invalid image");
          const imageBinary = atob(imageMatch[1]);
          if (imageBinary.length > 20 * 1024 * 1024) throw new Error("image too large");
          const imageBytes = new Uint8Array(imageBinary.length);
          for (let index = 0; index < imageBinary.length; index += 1) imageBytes[index] = imageBinary.charCodeAt(index);
          const form = new FormData();
          form.append("file", new Blob([imageBytes], { type: "image/png" }), filename);
          const response = await fetch("https://openapi.tripo3d.ai/v3/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` },
            body: form,
          });
          const uploaded = await response.json() as { code?: number; data?: { file_token?: string } };
          if (!response.ok || uploaded.code !== 0 || !uploaded.data?.file_token) throw new Error("upload failed");
          return uploaded.data.file_token;
        };
        const tokens: string[] = [];
        // Upload each required view sequentially to respect Tripo upload limits.
        for (const view of viewOrder) tokens.push(await uploadImage(body.views![view]!, `tamburins-${view}.png`));

        const startTask = async (model: string) => {
          const response = await fetch("https://openapi.tripo3d.ai/v3/generation/multiview-to-model", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              // Name each camera angle so Tripo aligns geometry and textures
              // with the same side of the generated turnaround sheet.
              inputs: tokens.map((file_token, index) => ({ [viewOrder[index]]: file_token })),
              model,
              texture: true,
              pbr: true,
              texture_quality: "standard",
              ...(model === "v3.1-20260211" ? { texture_version: "v3.5-20260815" } : {}),
              texture_alignment: "original_image",
              orientation: "align_image",
            }),
          });
          const payload = await response.json() as { code?: number; message?: string; data?: { task_id?: string } };
          return { response, payload, model };
        };
        let started = await startTask("v3.1-20260211");
        let task = started.payload;
        const primaryDetail = typeof task.message === "string" ? task.message.trim() : "";
        const shouldTryCompatibleModel = !task.data?.task_id && (
          /model.*(access|permission|unsupported|available)|forbidden/i.test(primaryDetail)
        );
        if (shouldTryCompatibleModel) {
          started = await startTask("v2.5-20250123");
          task = started.payload;
        }
        if (!started.response.ok || task.code !== 0 || !task.data?.task_id) {
          const detail = typeof task.message === "string" ? task.message.trim().slice(0, 180) : "";
          const creditIssue = /credit|balance|insufficient|not enough/i.test(detail);
          const error = creditIssue
            ? `Tripo API 사용 가능 크레딧이 부족합니다. 4면 텍스처 3D 생성에는 ${requiredCredits} 크레딧이 필요합니다. Tripo Studio가 아닌 API 지갑을 충전해주세요.`
            : started.response.status === 401
            ? `Tripo API 키가 만료되었거나 올바르지 않습니다.${detail ? ` ${detail}` : ""}`
            : started.response.status === 403
              ? `Tripo API 키는 인식됐지만 3D 생성 권한이 없습니다.${detail ? ` ${detail}` : ""}`
            : started.response.status === 429
              ? "3D 생성 요청이 많습니다. 잠시 후 다시 시도해주세요."
              : detail
                ? `3D 모델 생성 요청이 거절되었습니다: ${detail}`
                : "4면을 사용하는 3D 모델 생성을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.";
          return Response.json({ error }, { status: 502 });
        }
        await env.AR_OBJECTS.put(`tripo/${task.data.task_id}.json`, JSON.stringify({
          generationMode: "multiview",
          generationModel: started.model,
          inputViews: viewOrder,
          collection: (body.collection ?? "TAMBURINS").slice(0, 80),
          effects: (body.effects ?? []).filter((value) => typeof value === "string").slice(0, 22),
          strength: Math.max(0, Math.min(1, Number(body.strength) || 0)),
        }), { httpMetadata: { contentType: "application/json" } });
        await env.AR_OBJECTS.put(`tripo/${task.data.task_id}.png`, bytes, {
          httpMetadata: { contentType: "image/png" },
        });
        if (sourceJob) {
          sourceJob.tripoTaskId = task.data.task_id;
          sourceJob.status = "model";
          sourceJob.updatedAt = Date.now();
          await writeMuseJob(env, sourceJob);
        }
        return Response.json({ taskId: task.data.task_id });
      } catch {
        return Response.json({ error: "3D 변환 요청을 처리하지 못했습니다." }, { status: 500 });
      }
    }

    const tripoTaskMatch = url.pathname.match(/^\/api\/tripo-task\/([A-Za-z0-9_-]{8,128})$/);
    if (tripoTaskMatch && request.method === "GET") {
      try {
        if (!env.TRIPO_API_KEY) return Response.json({ error: "Tripo API 키가 설정되지 않았습니다." }, { status: 503 });
        const metadataObject = await env.AR_OBJECTS.get(`tripo/${tripoTaskMatch[1]}.json`);
        if (!metadataObject) return Response.json({ error: "3D 생성 작업을 찾지 못했습니다." }, { status: 404 });
        const metadata = await metadataObject.json() as { collection: string; effects?: string[]; strength?: number; arId?: string };
        if (metadata.arId) return Response.json({ status: "success", progress: 100, arUrl: `${url.origin}/?model=${metadata.arId}` });

        const taskResponse = await fetch(`https://openapi.tripo3d.ai/v3/tasks/${tripoTaskMatch[1]}`, {
          headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` },
        });
        const task = await taskResponse.json() as {
          code?: number;
          message?: string;
          data?: {
            status?: string;
            progress?: number;
            error_message?: string;
            output?: { model_url?: string; model?: string; pbr_model?: string; base_model?: string };
          };
        };
        if (!taskResponse.ok || task.code !== 0 || !task.data) {
          return Response.json({ error: "3D 생성 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
        }
        if (["failed", "cancelled", "banned", "expired", "unknown"].includes(task.data.status ?? "")) {
          return Response.json({ status: task.data.status, progress: task.data.progress ?? 0, error: "3D 모델 생성에 실패했습니다. 다시 시도해주세요." });
        }
        const modelUrl = task.data.output?.pbr_model
          ?? task.data.output?.model_url
          ?? task.data.output?.model
          ?? task.data.output?.base_model;
        if (task.data.status !== "success" || !modelUrl) {
          return Response.json({ status: task.data.status ?? "running", progress: task.data.progress ?? 0 });
        }

        try {
          const modelResponse = await fetch(modelUrl);
          if (!modelResponse.ok) throw new Error(`Tripo model download returned ${modelResponse.status}`);
          // A fetch response stream can lose its known length when it is passed
          // directly into R2. Materialize it first so the completed paid task can
          // be stored reliably instead of failing at 99%.
          const modelBytes = new Uint8Array(await modelResponse.arrayBuffer());
          if (!modelBytes.byteLength) throw new Error("Tripo model download was empty");
          const arId = crypto.randomUUID().replaceAll("-", "");
          await env.AR_OBJECTS.put(`ar/${arId}.glb`, modelBytes, {
            httpMetadata: { contentType: "model/gltf-binary" },
            customMetadata: { collection: metadata.collection },
          });
          const fallbackImage = await env.AR_OBJECTS.get(`tripo/${tripoTaskMatch[1]}.png`);
          if (fallbackImage) {
            await env.AR_OBJECTS.put(`ar/${arId}.png`, fallbackImage.body, {
              httpMetadata: { contentType: "image/png" },
              customMetadata: { collection: metadata.collection },
            });
          }
          await env.AR_OBJECTS.put(`tripo/${tripoTaskMatch[1]}.json`, JSON.stringify({ ...metadata, arId }), {
            httpMetadata: { contentType: "application/json" },
          });
          await env.AR_OBJECTS.put(`ar/${arId}.json`, JSON.stringify({
            collection: metadata.collection,
            effects: metadata.effects ?? [],
            strength: metadata.strength ?? 0,
          }), { httpMetadata: { contentType: "application/json" } });
          return Response.json({ status: "success", progress: 100, arUrl: `${url.origin}/?model=${arId}` });
        } catch (error) {
          console.warn("[tripo-task] Completed model is not stored yet; polling will retry the same paid task.", error);
          return Response.json({ status: "running", progress: 99, retryable: true });
        }
      } catch (error) {
        console.error("[tripo-task] Status handling failed.", error);
        return Response.json({ error: "3D 생성 상태를 처리하지 못했습니다." }, { status: 500 });
      }
    }

    const tripoPreviewMatch = url.pathname.match(/^\/api\/tripo-preview\/([A-Za-z0-9_-]{8,128})$/);
    if (tripoPreviewMatch && request.method === "GET") {
      const object = await env.AR_OBJECTS.get(`tripo/${tripoPreviewMatch[1]}.png`);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
    }

    const arModelMatch = url.pathname.match(/^\/api\/ar-model\/([a-f0-9]{32})$/);
    if (arModelMatch && request.method === "GET") {
      const object = await env.AR_OBJECTS.get(`ar/${arModelMatch[1]}.glb`);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("X-Tamburins-Collection", object.customMetadata?.collection ?? "TAMBURINS");
      return new Response(object.body, { headers });
    }

    const arMetaMatch = url.pathname.match(/^\/api\/ar-meta\/([a-f0-9]{32})$/);
    if (arMetaMatch && request.method === "GET") {
      const object = await env.AR_OBJECTS.get(`ar/${arMetaMatch[1]}.json`);
      if (!object) return Response.json({ collection: "YOUR TAMBURINS WORLD", effects: [], strength: 0 });
      const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" });
      return new Response(object.body, { headers });
    }

    if (url.pathname === "/api/ar-object" && request.method === "POST") {
      try {
        const body = await request.json() as { image?: string; collection?: string };
        const match = body.image?.match(/^data:image\/png;base64,(.+)$/);
        if (!match) return Response.json({ error: "완성 오브젝트 이미지가 없습니다." }, { status: 400 });
        const binary = atob(match[1]);
        if (binary.length > 8 * 1024 * 1024) return Response.json({ error: "이미지 용량이 너무 큽니다." }, { status: 413 });
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const id = crypto.randomUUID().replaceAll("-", "");
        await env.AR_OBJECTS.put(`ar/${id}.png`, bytes, {
          httpMetadata: { contentType: "image/png" },
          customMetadata: { collection: (body.collection ?? "TAMBURINS").slice(0, 80) },
        });
        return Response.json({ id, arUrl: `${url.origin}/?ar=${id}` });
      } catch {
        return Response.json({ error: "AR 링크를 만들지 못했습니다." }, { status: 500 });
      }
    }

    const arMatch = url.pathname.match(/^\/api\/ar-object\/([a-f0-9]{32})$/);
    if (arMatch && request.method === "GET") {
      const object = await env.AR_OBJECTS.get(`ar/${arMatch[1]}.png`);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("X-Tamburins-Collection", object.customMetadata?.collection ?? "TAMBURINS");
      return new Response(object.body, { headers });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
