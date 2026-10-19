import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { handleLibrary } from '../worker/library.ts';
const {publicKey,privateKey}=await generateKeyPair('RS256');
const key=await exportJWK(publicKey);key.kid='test';
const issuer='https://test.cloudflareaccess.com';
globalThis.fetch=async url=>{assert.equal(String(url),issuer+'/cdn-cgi/access/certs');return Response.json({keys:[key]});};
async function token(email,aud='student',exp='1h'){
  return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey);
}
class Statement{
  constructor(db,sql,params=[]){this.db=db;this.sql=sql;this.params=params;}
  bind(...params){return new Statement(this.db,this.sql,params.map(p=>p instanceof ArrayBuffer?new Uint8Array(p):p));}
  rows(){return this.db.prepare(this.sql).all(...this.params).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Uint8Array?Array.from(v):v])));}
  async first(){return this.rows()[0]||null;}
  async all(){return {results:this.rows()};}
  async run(){return this.db.prepare(this.sql).run(...this.params);}
}
function setup(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('migrations/0001_library.sql','utf8'));const DB={prepare:q=>new Statement(sql,q),batch:async stmts=>{sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {sql,env:{DB,LIBRARY_ACCESS_ISSUER:issuer,LIBRARY_STUDENT_AUD:'student',LIBRARY_ADMIN_AUD:'admin'}};}
const a=await token('a@example.test'), b=await token('b@example.test'),admin=await token('owner@example.test','admin');
function req(path,auth=a,method='GET',body,extra={}){return new Request('https://juis-ac.jp'+path,{method,body,headers:{...(auth?{'Cf-Access-Jwt-Assertion':auth}:{}),...(method!=='GET'?{Origin:'https://juis-ac.jp'}:{}),...extra}});}
async function add(env){const bytes=new Uint8Array(300000);bytes.set(new TextEncoder().encode('%PDF-1.4\n'));const r=await handleLibrary(req('/api/admin/library?title=Test&author=Author&kind=paper',admin,'POST',bytes,{'Content-Type':'application/pdf'}),env);assert.equal(r.status,201);return {id:(await r.json()).id,bytes};}
test('catalog, atomic competition, ownership, exact duration, return and stale return',async()=>{
  const {env}=setup();const {id,bytes}=await add(env);
  const catalog=await (await handleLibrary(req('/api/library/catalog',null),env)).json();assert.equal(catalog.items[0].title,'Test');assert.equal(JSON.stringify(catalog).includes('borrower'),false);
  const attempts=await Promise.all([handleLibrary(req(`/api/students/library/${id}/borrow`,a,'POST'),env),handleLibrary(req(`/api/students/library/${id}/borrow`,b,'POST'),env)]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);const win=attempts[0].status===201?a:b,lose=win===a?b:a;
  const loan=await attempts.find(r=>r.status===201).json();assert.equal(loan.due_at-loan.borrowed_at,604800);
  const file=`/api/students/library/${id}/file?loan=${loan.loan_id}`;
  assert.equal((await handleLibrary(req(file,lose),env)).status,403);
  const pdf=await handleLibrary(req(file,win),env);assert.equal(pdf.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(new Uint8Array(await pdf.arrayBuffer()),bytes);
  assert.equal((await handleLibrary(req(`/api/students/library/${id}/return?loan=${loan.loan_id}`,lose,'POST'),env)).status,409);
  assert.equal((await handleLibrary(req(`/api/students/library/${id}/return?loan=${loan.loan_id}`,win,'POST'),env)).status,200);
  assert.equal((await handleLibrary(req(file,win),env)).status,403);
  const next=await handleLibrary(req(`/api/students/library/${id}/borrow`,win,'POST'),env);assert.equal(next.status,201);
  assert.equal((await handleLibrary(req(`/api/students/library/${id}/return?loan=${loan.loan_id}`,win,'POST'),env)).status,409);
});
test('expiry, unpublished item, availability and new loan',async()=>{
  const {env,sql}=setup();const {id}=await add(env);
  const loan=await (await handleLibrary(req(`/api/students/library/${id}/borrow`,a,'POST'),env)).json();
  sql.prepare('UPDATE library_loans SET borrowed_at=unixepoch()-604800,due_at=unixepoch() WHERE item_id=?').run(id);
  assert.equal((await handleLibrary(req(`/api/students/library/${id}/file?loan=${loan.loan_id}`),env)).status,403);
  assert.equal((await handleLibrary(req(`/api/students/library/${id}/borrow`,b,'POST'),env)).status,201);
  assert.equal((await handleLibrary(req(`/api/admin/library/${id}`,admin,'PATCH',JSON.stringify({published:false})),env)).status,200);
  assert.equal((await (await handleLibrary(req('/api/library/catalog',null),env)).json()).items.length,0);
  const current=await (await handleLibrary(req('/api/students/library',b),env)).json();assert.equal(current.items.length,1);
  assert.equal((await handleLibrary(req(`/api/students/library/${id}/status?loan=${current.items[0].loan_id}`,b),env)).status,200);
});
test('reject missing/forged/expired auth, wrong audience, CSRF, invalid PDF and oversize',async()=>{
  const {env}=setup();
  for(const auth of [null,'forged',await token('a@example.test','student','-1s')])assert.equal((await handleLibrary(req('/api/students/library',auth),env)).status,401);
  assert.equal((await handleLibrary(req('/api/admin/library',a),env)).status,401);
  assert.equal((await handleLibrary(req('/api/admin/library',admin,'POST','x',{Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await handleLibrary(req('/api/admin/library?title=T&author=A&kind=book',admin,'POST','not a pdf',{'Content-Type':'application/pdf'}),env)).status,415);
  assert.equal((await handleLibrary(req('/api/admin/library?title=T&author=A&kind=book',admin,'POST','%PDF-',{'Content-Type':'application/pdf','Content-Length':'9000000'}),env)).status,413);
});
