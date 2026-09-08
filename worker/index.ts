// worker/index.ts
//
// JUISサイトは Astro の output: 'static' でビルドされた完全な静的サイトです。
// このWorkerが /api/以下のリクエストを処理し、それ以外は静的アセットを返します。
//
// 学生専用サイト（/students/以下）は Cloudflare Access で保護する前提です。
// Access配下のパスでは、Cloudflareが検証済みのメールアドレスを
// Cf-Access-Authenticated-User-Email ヘッダーに入れてリクエストを転送してくれます。
// このヘッダーは、対象パスがAccessで保護されている場合に限り
// クライアント側からの偽装ができません。/api/students/* もAccessの
// 保護対象パスに必ず含めてください（STUDENTS-SETUP.md参照）。
//
// ルーティングは下の `routes` テーブルにまとめています。
// 今後エンドポイントが増えても、この表に1行足すだけで済みます。

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type Handler = (request: Request, env: Env) => Promise<Response>;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getAccessEmail(request: Request): string | null {
  return request.headers.get("Cf-Access-Authenticated-User-Email");
}

// ---- 適性診断（/admissions/survey/） ----

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

async function handleSubmission(request: Request, env: Env): Promise<Response> {
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

// ---- 管理ダッシュボード（/admin/survey-results/） ----

async function handleAdminSummary(_request: Request, env: Env): Promise<Response> {
  const total = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM submissions"
  ).first<{ total: number }>();

  const byFaculty = await env.DB.prepare(
    `SELECT personality_type AS label, COUNT(*) AS count
     FROM submissions
     WHERE personality_type IS NOT NULL
     GROUP BY personality_type
     ORDER BY count DESC`
  ).all();

  const byEducation = await env.DB.prepare(
    `SELECT education AS label, COUNT(*) AS count
     FROM submissions
     WHERE education IS NOT NULL AND education != ''
     GROUP BY education
     ORDER BY count DESC`
  ).all();

  const byOccupation = await env.DB.prepare(
    `SELECT occupation AS label, COUNT(*) AS count
     FROM submissions
     WHERE occupation IS NOT NULL AND occupation != ''
     GROUP BY occupation
     ORDER BY count DESC`
  ).all();

  const recent = await env.DB.prepare(
    `SELECT created_at, personality_type, education, occupation
     FROM submissions
     ORDER BY created_at DESC
     LIMIT 20`
  ).all();

  return json(
    {
      total: total?.total ?? 0,
      byFaculty: byFaculty.results,
      byEducation: byEducation.results,
      byOccupation: byOccupation.results,
      recent: recent.results,
    },
    200
  );
}

// ---- 学生ポータル（/students/以下） ----

async function handleStudentMe(request: Request, env: Env): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) {
    return json({ error: "not_authenticated" }, 401);
  }

  const orders = await env.DB.prepare(
    `SELECT book_title, price, ordered_at
     FROM book_orders
     WHERE student_email = ?
     ORDER BY ordered_at DESC`
  )
    .bind(email)
    .all();

  return json({ email, orders: orders.results }, 200);
}

interface PurchaseBody {
  book_title?: string;
  price?: number;
}

async function handlePurchase(request: Request, env: Env): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) {
    return json({ error: "not_authenticated" }, 401);
  }

  let body: PurchaseBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { book_title, price } = body;
  if (!book_title || typeof price !== "number") {
    return json({ error: "book_title_and_price_required" }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO book_orders (student_email, book_title, price)
       VALUES (?, ?, ?)`
    )
      .bind(email, book_title, price)
      .run();
  } catch (err) {
    return json({ error: "db_write_failed" }, 500);
  }

  return json({ ok: true }, 200);
}

// ---- 掲示板（/students/board/） ----

async function handleBoardList(_request: Request, env: Env): Promise<Response> {
  const posts = await env.DB.prepare(
    `SELECT id, student_email, title, body, created_at
     FROM board_posts
     ORDER BY created_at DESC
     LIMIT 50`
  ).all();

  return json({ posts: posts.results }, 200);
}

interface BoardPostBody {
  title?: string;
  body?: string;
}

async function handleBoardPost(request: Request, env: Env): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) {
    return json({ error: "not_authenticated" }, 401);
  }

  let body: BoardPostBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const title = body.title?.trim();
  const content = body.body?.trim();
  if (!title || !content) {
    return json({ error: "title_and_body_required" }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO board_posts (student_email, title, body)
       VALUES (?, ?, ?)`
    )
      .bind(email, title, content)
      .run();
  } catch (err) {
    return json({ error: "db_write_failed" }, 500);
  }

  return json({ ok: true }, 200);
}

// ---- ルーティング表 ----
// 新しいエンドポイントは、ここに1行足すだけで使えるようになります。
// 例: "/api/students/progress": { GET: handleStudentProgress },

const routes: Record<string, Partial<Record<string, Handler>>> = {
  "/api/submissions": { POST: handleSubmission },
  "/api/admin/summary": { GET: handleAdminSummary },
  "/api/students/me": { GET: handleStudentMe },
  "/api/students/purchase": { POST: handlePurchase },
  "/api/students/board": { GET: handleBoardList, POST: handleBoardPost },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const methodHandlers = routes[url.pathname];

    if (methodHandlers) {
      const handler = methodHandlers[request.method];
      if (handler) return handler(request, env);
      return json({ error: "method_not_allowed" }, 405);
    }

    // ルート表にないパスは、静的アセット（distの中身）をそのまま返す
    return env.ASSETS.fetch(request);
  },
};
