// worker/index.ts
//
// JUISサイトは Astro の output: 'static' でビルドされた完全な静的サイトです
// （Astroのアダプターは使っていません）。そのため submissions.ts のような
// Astro APIルートは実行時に動きません。
//
// 代わりに、このWorkerスクリプトを ./dist の手前に1枚だけ挟みます。
// /api/submissions 宛のリクエストだけこのWorkerが処理し、それ以外は
// これまで通り ASSETS バインディング経由で静的ファイルを返します。
// サイトの他の部分（ビルド方法・ページ構成）は一切変更不要です。

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface SubmissionBody {
  session_id?: string;
  education?: string;
  faculty?: string | null;
  occupation?: string;
  personality_type?: string;
  answers?: unknown;
  contact_email?: string | null;
  consent?: number | boolean;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleSubmission(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body: SubmissionBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const {
    session_id,
    education,
    faculty,
    occupation,
    personality_type,
    answers,
    contact_email,
    consent,
  } = body;

  if (!session_id || typeof session_id !== "string") {
    return json({ error: "session_id_required" }, 400);
  }

  const consented = consent === 1 || consent === true;
  if (!consented) {
    return json({ error: "consent_required" }, 400);
  }

  const answersJson =
    typeof answers === "string" ? answers : JSON.stringify(answers ?? []);

  try {
    await env.DB.prepare(
      `INSERT INTO submissions
        (session_id, education, faculty, occupation, personality_type, answers, contact_email, consent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        session_id,
        education ?? null,
        faculty ?? null,
        occupation ?? null,
        personality_type ?? null,
        answersJson,
        contact_email ?? null,
        1
      )
      .run();
  } catch (err) {
    return json({ error: "db_write_failed" }, 500);
  }

  return json({ ok: true }, 200);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/submissions") {
      return handleSubmission(request, env);
    }

    // それ以外は静的アセット（distの中身）をそのまま返す
    return env.ASSETS.fetch(request);
  },
};
