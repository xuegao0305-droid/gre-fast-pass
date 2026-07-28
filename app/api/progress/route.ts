import { getChatGPTUser } from "../../chatgpt-auth";
import {
  normalizeCloudProgress,
  normalizeStoredProgress,
} from "../../lib/cloud-progress";
import { getRawDb } from "../../../db";

export const dynamic = "force-dynamic";

const tableSql = `
  CREATE TABLE IF NOT EXISTS user_progress (
    user_id TEXT PRIMARY KEY NOT NULL,
    progress_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )
`;

async function getIdentity(request: Request) {
  const user = await getChatGPTUser();
  if (user) {
    return {
      id: user.email.toLowerCase(),
      label: user.displayName,
    };
  }

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return { id: "local-preview", label: "本地预览" };
  }

  return null;
}

async function ensureTable() {
  const db = getRawDb();
  await db.prepare(tableSql).run();
  return db;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    const identity = await getIdentity(request);
    if (!identity) {
      return noStoreJson({ error: "需要登录后才能读取进度。" }, { status: 401 });
    }

    const db = await ensureTable();
    const row = await db
      .prepare(
        "SELECT progress_json, revision, updated_at FROM user_progress WHERE user_id = ?1",
      )
      .bind(identity.id)
      .first<{
        progress_json: string;
        revision: number;
        updated_at: number;
      }>();

    let progress = null;
    if (row) {
      try {
        progress = normalizeStoredProgress(JSON.parse(row.progress_json));
      } catch {
        progress = null;
      }
    }

    return noStoreJson({
      progress,
      account: identity.label,
      updatedAt: row?.updated_at ?? null,
    });
  } catch {
    return noStoreJson(
      { error: "暂时无法读取云端进度。" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getIdentity(request);
    if (!identity) {
      return noStoreJson({ error: "需要登录后才能保存进度。" }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 1_000_000) {
      return noStoreJson({ error: "进度数据过大。" }, { status: 413 });
    }

    const body = (await request.json()) as { progress?: unknown };
    const progress = normalizeCloudProgress(body.progress);
    if (!progress) {
      return noStoreJson({ error: "进度数据无效。" }, { status: 400 });
    }

    const db = await ensureTable();
    const updatedAt = Date.now();
    await db
      .prepare(
        `INSERT INTO user_progress (
          user_id, progress_json, revision, updated_at
        ) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(user_id) DO UPDATE SET
          progress_json = excluded.progress_json,
          revision = excluded.revision,
          updated_at = excluded.updated_at
        WHERE excluded.revision >= user_progress.revision`,
      )
      .bind(
        identity.id,
        JSON.stringify(progress),
        progress.revision,
        updatedAt,
      )
      .run();

    return noStoreJson({
      ok: true,
      revision: progress.revision,
      updatedAt,
    });
  } catch {
    return noStoreJson(
      { error: "暂时无法保存云端进度。" },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await getIdentity(request);
    if (!identity) {
      return noStoreJson({ error: "需要登录后才能清空进度。" }, { status: 401 });
    }

    const db = await ensureTable();
    await db
      .prepare("DELETE FROM user_progress WHERE user_id = ?1")
      .bind(identity.id)
      .run();
    return noStoreJson({ ok: true });
  } catch {
    return noStoreJson(
      { error: "暂时无法清空云端进度。" },
      { status: 503 },
    );
  }
}
