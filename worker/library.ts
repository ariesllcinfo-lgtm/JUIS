import { createRemoteJWKSet, jwtVerify } from 'jose';

type LibraryEnv = Pick<Env, 'DB' | 'LIBRARY_ACCESS_ISSUER' | 'LIBRARY_STUDENT_AUD' | 'LIBRARY_ADMIN_AUD'>;
const WEEK = 604800;
const MAX_PDF = 8 * 1024 * 1024;
const CHUNK = 256 * 1024;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function libraryIdentity(request: Request, env: LibraryEnv, admin: boolean): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  try {
    const keys = createRemoteJWKSet(new URL(`${env.LIBRARY_ACCESS_ISSUER}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, keys, {
      issuer: env.LIBRARY_ACCESS_ISSUER,
      audience: admin ? env.LIBRARY_ADMIN_AUD : env.LIBRARY_STUDENT_AUD,
      algorithms: ['RS256'], requiredClaims: ['exp', 'email'],
    });
    return typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null;
  } catch { return null; }
}

// One conditional UPSERT is the lock. Never SELECT availability then INSERT.
export async function borrow(db: D1Database, id: string, email: string) {
  return db.prepare(`INSERT INTO library_loans (item_id,loan_id,borrower,borrowed_at,due_at)
    SELECT id, ?, ?, unixepoch(), unixepoch()+${WEEK} FROM library_items WHERE id=? AND published=1
    ON CONFLICT(item_id) DO UPDATE SET loan_id=excluded.loan_id, borrower=excluded.borrower,
      borrowed_at=excluded.borrowed_at, due_at=excluded.due_at
    WHERE library_loans.due_at <= unixepoch()
    RETURNING loan_id, borrowed_at, due_at`).bind(crypto.randomUUID(), email, id).first();
}

async function boundedBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('Content-Length')) > limit) throw new Error('too_large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function handleLibrary(request: Request, env: LibraryEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const publicCatalog = path === '/api/library/catalog';
  const admin = path.startsWith('/api/admin/library');
  if (!publicCatalog && !admin && !path.startsWith('/api/students/library')) return null;
  try {
    if (publicCatalog) {
      if (request.method !== 'GET') return json({error:'method_not_allowed'},405);
      const rows = await env.DB.prepare(`SELECT i.id,i.title,i.author,i.kind,i.description,
        CASE WHEN l.due_at>unixepoch() THEN l.due_at ELSE NULL END AS due_at
        FROM library_items i LEFT JOIN library_loans l ON l.item_id=i.id
        WHERE i.published=1 ORDER BY i.created_at DESC,i.id`).all();
      return json({items:rows.results});
    }
    const email = await libraryIdentity(request, env, admin);
    if (!email) return json({error:'not_authenticated'},401);
    if (!['GET','HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin)
      return json({error:'invalid_origin'},403);
    if (path === '/api/students/library' && request.method === 'GET') {
      const rows = await env.DB.prepare(`SELECT i.id,i.title,i.author,i.kind,i.description,
        CASE WHEN l.due_at>unixepoch() THEN l.due_at ELSE NULL END AS due_at,
        CASE WHEN l.due_at>unixepoch() AND l.borrower=? THEN l.loan_id ELSE NULL END AS loan_id
        FROM library_items i LEFT JOIN library_loans l ON l.item_id=i.id
        WHERE i.published=1 OR (l.borrower=? AND l.due_at>unixepoch()) ORDER BY i.created_at DESC,i.id`).bind(email,email).all();
      return json({items:rows.results});
    }
    if (path === '/api/admin/library' && request.method === 'GET') {
      const rows=await env.DB.prepare(`SELECT i.*, CASE WHEN l.due_at>unixepoch() THEN l.due_at ELSE NULL END AS due_at
        FROM library_items i LEFT JOIN library_loans l ON l.item_id=i.id ORDER BY i.created_at DESC,i.id`).all();
      return json({items:rows.results});
    }
    if (path === '/api/admin/library' && request.method === 'POST') {
      if (request.headers.get('Content-Type') !== 'application/pdf') return json({error:'pdf_required'},415);
      const title=url.searchParams.get('title')?.trim() || '';
      const author=url.searchParams.get('author')?.trim() || '';
      const kind=url.searchParams.get('kind'); const description=url.searchParams.get('description')?.trim() || '';
      if (!title || title.length>200 || !author || author.length>100 || !['paper','book'].includes(kind || '') || description.length>2000)
        return json({error:'invalid_metadata'},400);
      const bytes=await boundedBytes(request,MAX_PDF);
      if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') return json({error:'pdf_required'},415);
      const id=crypto.randomUUID(); const count=Math.ceil(bytes.length/CHUNK);
      const statements=[env.DB.prepare(`INSERT INTO library_items(id,title,author,kind,description,byte_size,chunk_count) VALUES(?,?,?,?,?,?,?)`)
        .bind(id,title,author,kind,description,bytes.length,count)];
      for (let n=0;n<count;n++) statements.push(env.DB.prepare('INSERT INTO library_chunks(item_id,chunk_index,data) VALUES(?,?,?)')
        .bind(id,n,bytes.slice(n*CHUNK,(n+1)*CHUNK).buffer));
      await env.DB.batch(statements);
      return json({id},201);
    }
    const toggle=path.match(/^\/api\/admin\/library\/([a-f0-9-]{36})$/);
    if (toggle && request.method==='PATCH') {
      const body=JSON.parse(new TextDecoder().decode(await boundedBytes(request,1024)));
      if (typeof body.published!=='boolean') return json({error:'invalid_metadata'},400);
      const result=await env.DB.prepare('UPDATE library_items SET published=? WHERE id=? RETURNING id').bind(body.published?1:0,toggle[1]).first();
      return result ? json({ok:true}) : json({error:'not_found'},404);
    }
    const action=path.match(/^\/api\/students\/library\/([a-f0-9-]{36})\/(borrow|return|file|status)$/);
    if (!action) return json({error:'not_found'},404);
    const [,id,verb]=action;
    if (verb==='borrow' && request.method==='POST') {
      const loan=await borrow(env.DB,id,email);
      return loan ? json(loan,201) : json({error:'unavailable'},409);
    }
    if (verb==='return' && request.method==='POST') {
      const loanId=url.searchParams.get('loan');
      // Exact loan ID prevents a delayed return from deleting a newer loan.
      const result=await env.DB.prepare('DELETE FROM library_loans WHERE item_id=? AND borrower=? AND loan_id=? RETURNING item_id')
        .bind(id,email,loanId || '').first();
      return result ? json({ok:true}) : json({error:'loan_not_found'},409);
    }
    if (['file','status'].includes(verb) && request.method==='GET') {
      const loan=await env.DB.prepare(`SELECT l.loan_id,l.due_at,i.byte_size,i.chunk_count FROM library_loans l
        JOIN library_items i ON i.id=l.item_id WHERE l.item_id=? AND l.borrower=? AND l.loan_id=? AND l.due_at>unixepoch()`)
        .bind(id,email,url.searchParams.get('loan') || '').first<{loan_id:string;due_at:number;byte_size:number;chunk_count:number}>();
      if (!loan) return json({error:'loan_expired_or_missing'},403);
      if (verb==='status') return json({due_at:loan.due_at,server_now:Math.floor(Date.now()/1000)});
      let index=0;
      const stream=new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            // Check ownership/expiry on each chunk, including during a long transfer.
            const row=await env.DB.prepare(`SELECT c.data FROM library_chunks c JOIN library_loans l ON l.item_id=c.item_id
              WHERE c.item_id=? AND c.chunk_index=? AND l.borrower=? AND l.loan_id=? AND l.due_at>unixepoch()`)
              .bind(id,index,email,loan.loan_id).first<{data:number[]}>();
            if (!row) {controller.error(new Error('loan_unavailable'));return;}
            controller.enqueue(new Uint8Array(row.data)); index++;
            if(index>=loan.chunk_count) controller.close();
          } catch(e) {controller.error(e);}
        }
      });
      return new Response(stream,{headers:{...headers,'Content-Type':'application/pdf','Content-Length':String(loan.byte_size),
        'Content-Disposition':'inline; filename="library.pdf"','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'no-referrer'}});
    }
    return json({error:'method_not_allowed'},405);
  } catch(e) {
    if(e instanceof Error && e.message==='too_large') return json({error:'file_too_large'},413);
    if(e instanceof SyntaxError) return json({error:'invalid_json'},400);
    console.error('library_request_failed',e instanceof Error ? e.name : 'unknown');
    return json({error:'library_unavailable'},503);
  }
}
