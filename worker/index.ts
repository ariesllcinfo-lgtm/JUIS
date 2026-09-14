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
  CREATOR_DB: D1Database;
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

// ---- 学生アカウント登録（/students/register/） ----

const FACULTY_CODES: Record<string, string> = {
  情報法経学部: "LE",
  社会福祉学部: "WF",
  知的財産商学部: "IP",
  コミュニケーション保障学部: "CA",
  システム農学部: "AG",
  "College of Design": "DS",
};

async function handleProfile(request: Request, env: Env): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) {
    return json({ error: "not_authenticated" }, 401);
  }

  let profile = await env.DB.prepare(
    `SELECT email, name, faculty, enrollment_year, student_id
     FROM students
     WHERE email = ?`
  )
    .bind(email)
    .first();

  if (!profile) {
    // このメールアドレス宛の変更申請が来ていないか確認する。
    // Accessでこのメールにログインできた時点で「本人が新しいメールも
    // 持っている」ことは証明済みなので、そのまま引き継ぎを実行する。
    const pending = await env.DB.prepare(
      `SELECT old_email FROM email_change_requests WHERE new_email = ?`
    )
      .bind(email)
      .first<{ old_email: string }>();

    if (pending) {
      await env.DB.batch([
        env.DB.prepare("UPDATE students SET email = ? WHERE email = ?").bind(
          email,
          pending.old_email
        ),
        env.DB.prepare(
          "UPDATE board_posts SET student_email = ? WHERE student_email = ?"
        ).bind(email, pending.old_email),
        env.DB.prepare(
          "UPDATE book_orders SET student_email = ? WHERE student_email = ?"
        ).bind(email, pending.old_email),
        env.DB.prepare(
          "DELETE FROM email_change_requests WHERE old_email = ?"
        ).bind(pending.old_email),
      ]);

      // creator_users は別のD1データベース（CREATOR_DB）にあるため、
      // 上のbatchとは別トランザクションになるが、続けて反映しておく。
      // 該当レコードが無い（創作者コミュニティ未参加）場合は0件更新で正常終了する。
      await env.CREATOR_DB.prepare(
        "UPDATE creator_users SET email = ? WHERE email = ?"
      )
        .bind(email, pending.old_email)
        .run();

      profile = await env.DB.prepare(
        `SELECT email, name, faculty, enrollment_year, student_id
         FROM students
         WHERE email = ?`
      )
        .bind(email)
        .first();
    }
  }

  if (!profile) {
    return json({ error: "not_registered" }, 404);
  }

  return json(profile, 200);
}

interface EmailChangeBody {
  new_email?: string;
}

async function handleRequestEmailChange(
  request: Request,
  env: Env
): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) {
    return json({ error: "not_authenticated" }, 401);
  }

  const student = await env.DB.prepare(
    "SELECT email FROM students WHERE email = ?"
  )
    .bind(email)
    .first();
  if (!student) {
    return json({ error: "not_registered" }, 404);
  }

  let body: EmailChangeBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const newEmail = body.new_email?.trim().toLowerCase();
  if (!newEmail || !newEmail.includes("@")) {
    return json({ error: "valid_new_email_required" }, 400);
  }

  try {
    // 同じメールで再申請した場合に備えて置き換える
    await env.DB.prepare(
      `INSERT INTO email_change_requests (old_email, new_email)
       VALUES (?, ?)
       ON CONFLICT(old_email) DO UPDATE SET new_email = excluded.new_email, requested_at = datetime('now')`
    )
      .bind(email, newEmail)
      .run();
  } catch (err) {
    return json({ error: "db_write_failed" }, 500);
  }

  return json({ ok: true }, 200);
}

interface RegisterBody {
  name?: string;
  faculty?: string;
  enrollment_year?: number;
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) {
    return json({ error: "not_authenticated" }, 401);
  }

  const existing = await env.DB.prepare(
    "SELECT email FROM students WHERE email = ?"
  )
    .bind(email)
    .first();
  if (existing) {
    return json({ error: "already_registered" }, 409);
  }

  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const name = body.name?.trim();
  const faculty = body.faculty?.trim();
  const enrollmentYear = body.enrollment_year;
  const facultyCode = faculty ? FACULTY_CODES[faculty] : undefined;

  if (!name || !faculty || !facultyCode || !enrollmentYear) {
    return json({ error: "invalid_input" }, 400);
  }

  // 学籍番号を「入学年度下2桁 + 学部コード + 連番4桁」で自動採番する
  const yearSuffix = String(enrollmentYear % 100).padStart(2, "0");
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM students
     WHERE faculty = ? AND enrollment_year = ?`
  )
    .bind(faculty, enrollmentYear)
    .first<{ count: number }>();
  const sequence = String((countRow?.count ?? 0) + 1).padStart(4, "0");
  const studentId = `${yearSuffix}${facultyCode}${sequence}`;

  try {
    await env.DB.prepare(
      `INSERT INTO students (email, name, faculty, enrollment_year, student_id)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(email, name, faculty, enrollmentYear, studentId)
      .run();
  } catch (err) {
    return json({ error: "db_write_failed" }, 500);
  }

  return json({ email, name, faculty, enrollment_year: enrollmentYear, student_id: studentId }, 200);
}

// ---- 掲示板（/students/board/） ----

async function handleBoardList(_request: Request, env: Env): Promise<Response> {
  const posts = await env.DB.prepare(
    `SELECT board_posts.id, board_posts.title, board_posts.body, board_posts.created_at,
            board_posts.student_email,
            COALESCE(students.name, board_posts.student_email) AS display_name
     FROM board_posts
     LEFT JOIN students ON students.email = board_posts.student_email
     ORDER BY board_posts.created_at DESC
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

// ---- 管理者によるメールアドレス変更（/admin/students/） ----

async function handleAdminStudentSearch(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) {
    return json({ students: [] }, 200);
  }

  const results = await env.DB.prepare(
    `SELECT email, name, faculty, student_id
     FROM students
     WHERE student_id LIKE ? OR name LIKE ?
     LIMIT 20`
  )
    .bind(`%${q}%`, `%${q}%`)
    .all();

  return json({ students: results.results }, 200);
}

interface AdminUpdateEmailBody {
  student_id?: string;
  new_email?: string;
}

async function handleAdminUpdateEmail(
  request: Request,
  env: Env
): Promise<Response> {
  let body: AdminUpdateEmailBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const studentId = body.student_id?.trim();
  const newEmail = body.new_email?.trim().toLowerCase();
  if (!studentId || !newEmail || !newEmail.includes("@")) {
    return json({ error: "student_id_and_valid_email_required" }, 400);
  }

  const student = await env.DB.prepare(
    "SELECT email FROM students WHERE student_id = ?"
  )
    .bind(studentId)
    .first<{ email: string }>();

  if (!student) {
    return json({ error: "student_not_found" }, 404);
  }

  const oldEmail = student.email;

  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE students SET email = ? WHERE student_id = ?").bind(
        newEmail,
        studentId
      ),
      env.DB.prepare(
        "UPDATE board_posts SET student_email = ? WHERE student_email = ?"
      ).bind(newEmail, oldEmail),
      env.DB.prepare(
        "UPDATE book_orders SET student_email = ? WHERE student_email = ?"
      ).bind(newEmail, oldEmail),
      env.DB.prepare("DELETE FROM email_change_requests WHERE old_email = ?").bind(
        oldEmail
      ),
      env.DB.prepare("DELETE FROM email_change_requests WHERE new_email = ?").bind(
        newEmail
      ),
    ]);
  } catch (err) {
    return json({ error: "db_write_failed" }, 500);
  }

  return json({ ok: true, email: newEmail }, 200);
}

// ---- 創作者コミュニティ（/students/creator/） ----
//
// juis-db（CREATOR_DB）を使用する。juis-admissions（DB）とは別のD1データベース。
// 教員／学生の判定は自己申告させず、初回アクセス時は全員 student／見習い として
// 自動登録し、教員への昇格は /admin/creator-promote/ からの手動操作でのみ行う。

interface CreatorProfile {
  id: number;
  email: string;
  display_name: string;
  user_type: string;
  current_rank: string;
}

async function ensureCreatorUser(email: string, env: Env): Promise<CreatorProfile> {
  let user = await env.CREATOR_DB.prepare(
    `SELECT * FROM creator_users WHERE email = ?`
  )
    .bind(email)
    .first<CreatorProfile>();

  if (!user) {
    user = await env.CREATOR_DB.prepare(
      `INSERT INTO creator_users (email, display_name, user_type, current_rank)
       VALUES (?, ?, 'student', '見習い') RETURNING *`
    )
      .bind(email, email.split("@")[0])
      .first<CreatorProfile>();
  }

  return user!;
}

async function handleCreatorMe(request: Request, env: Env): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) return json({ error: "not_authenticated" }, 401);

  const user = await ensureCreatorUser(email, env);
  return json(user, 200);
}

// アカウントページ（/students/account/）用の非破壊な参照エンドポイント。
// handleCreatorMeと違い、レコードが無くても自動登録は行わない
// （アカウント情報を見ただけで勝手に創作者コミュニティへ登録されるのを防ぐため）。
async function handleCreatorProfilePeek(
  request: Request,
  env: Env
): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) return json({ error: "not_authenticated" }, 401);

  const user = await env.CREATOR_DB.prepare(
    `SELECT * FROM creator_users WHERE email = ?`
  )
    .bind(email)
    .first<CreatorProfile>();

  if (!user) return json({ error: "not_registered" }, 404);
  return json(user, 200);
}

const WORKS_PAGE_SIZE = 20;

async function handleCreatorWorksList(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const term = url.searchParams.get("term")?.trim();
  const type = url.searchParams.get("type")?.trim();
  const sort = url.searchParams.get("sort") === "cited" ? "cited" : "new";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const offset = (page - 1) * WORKS_PAGE_SIZE;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    conditions.push("w.title LIKE ?");
    params.push(`%${q}%`);
  }
  if (term) {
    conditions.push("w.academic_term = ?");
    params.push(term);
  }
  if (type) {
    conditions.push("w.work_type = ?");
    params.push(type);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  // デフォルトは新着順。被引用数順はオプション扱いとし、
  // 先行投稿が構造的に有利であり続ける状態を検索機能側が助長しないようにする。
  const orderClause =
    sort === "cited"
      ? "ORDER BY citation_count DESC, w.created_at DESC"
      : "ORDER BY w.created_at DESC";

  const sql = `
    SELECT w.*, u.display_name AS author_name, u.current_rank AS author_rank,
      (SELECT COUNT(*) FROM citations c WHERE c.cited_work_id = w.id) AS citation_count
    FROM works w JOIN creator_users u ON w.author_id = u.id
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `;

  const works = await env.CREATOR_DB.prepare(sql)
    .bind(...params, WORKS_PAGE_SIZE, offset)
    .all();

  return json({ works: works.results, page, page_size: WORKS_PAGE_SIZE }, 200);
}

interface CreateWorkBody {
  title?: string;
  work_type?: string;
  body?: string;
  academic_term?: string;
}

async function handleCreatorWorksCreate(
  request: Request,
  env: Env
): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) return json({ error: "not_authenticated" }, 401);
  const user = await ensureCreatorUser(email, env);

  let body: CreateWorkBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const title = body.title?.trim();
  const term = body.academic_term?.trim();
  if (!title || !term) {
    return json({ error: "title_and_academic_term_required" }, 400);
  }

  const result = await env.CREATOR_DB.prepare(
    `INSERT INTO works (author_id, title, work_type, body, academic_term)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(user.id, title, body.work_type ?? null, body.body ?? null, term)
    .first();

  return json(result, 201);
}

interface CreateCitationBody {
  citing_work_id?: number;
  cited_work_id?: number;
  academic_term?: string;
}

async function handleCreatorCitationsCreate(
  request: Request,
  env: Env
): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) return json({ error: "not_authenticated" }, 401);
  const user = await ensureCreatorUser(email, env);

  let body: CreateCitationBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { citing_work_id, cited_work_id, academic_term } = body;
  if (!citing_work_id || !cited_work_id || !academic_term) {
    return json(
      { error: "citing_work_id_cited_work_id_academic_term_required" },
      400
    );
  }
  if (citing_work_id === cited_work_id) {
    return json({ error: "cannot_cite_same_work" }, 400);
  }

  const citingWork = await env.CREATOR_DB.prepare(
    `SELECT author_id FROM works WHERE id = ?`
  )
    .bind(citing_work_id)
    .first<{ author_id: number }>();
  if (!citingWork || citingWork.author_id !== user.id) {
    return json({ error: "citing_work_must_be_your_own" }, 403);
  }

  const citedWork = await env.CREATOR_DB.prepare(
    `SELECT author_id FROM works WHERE id = ?`
  )
    .bind(cited_work_id)
    .first<{ author_id: number }>();
  if (!citedWork) return json({ error: "cited_work_not_found" }, 404);
  if (citedWork.author_id === user.id) {
    return json({ error: "self_citation_not_allowed" }, 400);
  }

  try {
    const result = await env.CREATOR_DB.prepare(
      `INSERT INTO citations (citing_work_id, cited_work_id, citing_user_id, academic_term)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
      .bind(citing_work_id, cited_work_id, user.id, academic_term)
      .first();
    return json(result, 201);
  } catch {
    return json({ error: "duplicate_citation" }, 409);
  }
}

interface CreateMentorshipBody {
  mentor_email?: string;
  work_id?: number;
  academic_term?: string;
}

async function handleCreatorMentorshipsCreate(
  request: Request,
  env: Env
): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) return json({ error: "not_authenticated" }, 401);
  const student = await ensureCreatorUser(email, env);

  let body: CreateMentorshipBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const mentorEmail = body.mentor_email?.trim();
  const term = body.academic_term?.trim();
  if (!mentorEmail || !term) {
    return json({ error: "mentor_email_and_academic_term_required" }, 400);
  }

  const mentor = await env.CREATOR_DB.prepare(
    `SELECT * FROM creator_users WHERE email = ? AND user_type = 'faculty'`
  )
    .bind(mentorEmail)
    .first<CreatorProfile>();
  if (!mentor) return json({ error: "mentor_not_found_or_not_faculty" }, 404);

  const result = await env.CREATOR_DB.prepare(
    `INSERT INTO mentorships (mentor_id, student_id, work_id, academic_term, status)
     VALUES (?, ?, ?, ?, 'pending') RETURNING *`
  )
    .bind(mentor.id, student.id, body.work_id ?? null, term)
    .first();

  return json(result, 201);
}

async function handleCreatorMentorshipsList(
  request: Request,
  env: Env
): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) return json({ error: "not_authenticated" }, 401);
  const user = await ensureCreatorUser(email, env);

  const results = await env.CREATOR_DB.prepare(
    `SELECT m.*, mu.display_name AS mentor_name, su.display_name AS student_name
     FROM mentorships m
     JOIN creator_users mu ON m.mentor_id = mu.id
     JOIN creator_users su ON m.student_id = su.id
     WHERE m.mentor_id = ? OR m.student_id = ?
     ORDER BY m.created_at DESC`
  )
    .bind(user.id, user.id)
    .all();

  return json({ mentorships: results.results, my_id: user.id }, 200);
}

async function handleCreatorMentorshipConfirm(
  request: Request,
  env: Env,
  mentorshipId: string
): Promise<Response> {
  const email = getAccessEmail(request);
  if (!email) return json({ error: "not_authenticated" }, 401);
  const user = await ensureCreatorUser(email, env);

  const mentorship = await env.CREATOR_DB.prepare(
    `SELECT mentor_id FROM mentorships WHERE id = ?`
  )
    .bind(mentorshipId)
    .first<{ mentor_id: number }>();
  if (!mentorship) return json({ error: "not_found" }, 404);
  if (mentorship.mentor_id !== user.id) {
    return json({ error: "only_mentor_can_confirm" }, 403);
  }

  const result = await env.CREATOR_DB.prepare(
    `UPDATE mentorships SET status = 'confirmed' WHERE id = ? RETURNING *`
  )
    .bind(mentorshipId)
    .first();

  return json(result, 200);
}

// ---- 管理者：教員への昇格（/admin/creator-promote/） ----
// /admin/以下はCloudflare Accessで管理者のみに制限されている前提。
// （他のadmin系ハンドラと同様、ここでもアプリ側の追加認可は行わない）

async function handleAdminCreatorSearch(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) return json({ users: [] }, 200);

  const results = await env.CREATOR_DB.prepare(
    `SELECT id, email, display_name, user_type, current_rank
     FROM creator_users
     WHERE email LIKE ? OR display_name LIKE ?
     LIMIT 20`
  )
    .bind(`%${q}%`, `%${q}%`)
    .all();

  return json({ users: results.results }, 200);
}

interface PromoteBody {
  user_id?: number;
  new_rank?: string;
}

const VALID_RANKS = ["見習い", "助教授", "准教授", "教授"];

async function handleAdminCreatorPromote(
  request: Request,
  env: Env
): Promise<Response> {
  let body: PromoteBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { user_id, new_rank } = body;
  if (!user_id || !new_rank || !VALID_RANKS.includes(new_rank)) {
    return json({ error: "user_id_and_valid_new_rank_required" }, 400);
  }

  // 助教授以上への変更は教員種別も同時に切り替える（見習いへの降格は学生に戻す）
  const userType = new_rank === "見習い" ? "student" : "faculty";

  const result = await env.CREATOR_DB.prepare(
    `UPDATE creator_users SET user_type = ?, current_rank = ?, rank_updated_at = datetime('now')
     WHERE id = ? RETURNING *`
  )
    .bind(userType, new_rank, user_id)
    .first();

  if (!result) return json({ error: "user_not_found" }, 404);
  return json(result, 200);
}

// ---- ルーティング表 ----
// 新しいエンドポイントは、ここに1行足すだけで使えるようになります。
// 例: "/api/students/progress": { GET: handleStudentProgress },

const routes: Record<string, Partial<Record<string, Handler>>> = {
  "/api/submissions": { POST: handleSubmission },
  "/api/admin/summary": { GET: handleAdminSummary },
  "/api/students/me": { GET: handleStudentMe },
  "/api/students/profile": { GET: handleProfile },
  "/api/students/register": { POST: handleRegister },
  "/api/students/request-email-change": { POST: handleRequestEmailChange },
  "/api/admin/students/search": { GET: handleAdminStudentSearch },
  "/api/admin/students/update-email": { POST: handleAdminUpdateEmail },
  "/api/students/purchase": { POST: handlePurchase },
  "/api/students/board": { GET: handleBoardList, POST: handleBoardPost },
  "/api/students/creator/me": { GET: handleCreatorMe },
  "/api/students/creator/profile": { GET: handleCreatorProfilePeek },
  "/api/students/creator/works": {
    GET: handleCreatorWorksList,
    POST: handleCreatorWorksCreate,
  },
  "/api/students/creator/citations": { POST: handleCreatorCitationsCreate },
  "/api/students/creator/mentorships": {
    GET: handleCreatorMentorshipsList,
    POST: handleCreatorMentorshipsCreate,
  },
  "/api/admin/creator/search": { GET: handleAdminCreatorSearch },
  "/api/admin/creator/promote": { POST: handleAdminCreatorPromote },
};

// 動的セグメントを含むパス（/api/students/creator/mentorships/:id/confirm）は
// 上の静的ルート表では表現できないため、ここで個別にマッチさせる。
const mentorshipConfirmPattern =
  /^\/api\/students\/creator\/mentorships\/(\d+)\/confirm$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const confirmMatch = url.pathname.match(mentorshipConfirmPattern);
    if (confirmMatch && request.method === "PATCH") {
      return handleCreatorMentorshipConfirm(request, env, confirmMatch[1]);
    }

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
