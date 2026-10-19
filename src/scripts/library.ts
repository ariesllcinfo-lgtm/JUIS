interface Item { id:string;title:string;author:string;kind:string;description:string;due_at:number|null;loan_id?:string|null; }
export function initCatalog() {
  const root=document.getElementById('library-catalog'); if(!root)return;
  const member=root.dataset.member==='true';
  const message=document.getElementById('library-message')!;
  const results=document.getElementById('library-results')!;
  const search=document.getElementById('library-search') as HTMLInputElement;
  const kind=document.getElementById('library-kind') as HTMLSelectElement;
  const status=document.getElementById('library-status') as HTMLSelectElement;
  const retry=document.getElementById('library-retry') as HTMLButtonElement;
  let items:Item[]=[]; let loading=false;
  const date=(s:number)=>new Date(s*1000).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
  function element(tag:string,text:string,className=''){const el=document.createElement(tag);el.textContent=text;el.className=className;return el;}
  function render(){
    results.replaceChildren();const q=search.value.trim().toLocaleLowerCase();
    const filtered=items.filter(i=>(!q || `${i.title} ${i.author} ${i.description}`.toLocaleLowerCase().includes(q)) && (!kind.value||kind.value===i.kind) && (!status.value || (status.value==='mine'?!!i.loan_id:!i.due_at)));
    message.textContent=`${filtered.length}件の資料`;
    if(!filtered.length){results.append(element('p',items.length?'条件に一致する資料はありません。':'資料は準備中です。登録後、ここに論文・書籍が並びます。','library-empty'));return;}
    for(const i of filtered){
      const card=element('article','','library-card');
      card.append(element('span',i.kind==='paper'?'論文':'書籍','badge'),element('h2',i.title),element('p',i.author),element('p',i.description,'description'));
      card.append(element('p',i.loan_id?`借りています · 期限 ${date(i.due_at!)}（日本時間）`:i.due_at?`貸出中 · 返却予定 ${date(i.due_at)}（日本時間）`:'貸出可能 · 7日間','availability'+(i.due_at&&!i.loan_id?' busy':'')));
      const actions=element('div','','library-actions');
      if(!member){const a=document.createElement('a');a.href='/students/library/';a.textContent='ログインして利用する';actions.append(a);}
      else if(i.loan_id){
        const a=document.createElement('a');a.href=`/students/library/read/?id=${encodeURIComponent(i.id)}&loan=${encodeURIComponent(i.loan_id)}`;a.textContent='読む';actions.append(a);
        const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='返却する';b.onclick=()=>{if(confirm(`「${i.title}」を返却しますか？閲覧できなくなります。`))void mutate(i,'return',b);};actions.append(b);
      }else if(!i.due_at){const b=document.createElement('button');b.type='button';b.textContent='7日間借りる';b.onclick=()=>void mutate(i,'borrow',b);actions.append(b);}
      card.append(actions);results.append(card);
    }
  }
  async function mutate(i:Item,action:string,button:HTMLButtonElement){
    button.disabled=true;message.textContent='処理しています…';
    try{
      const r=await fetch(`/api/students/library/${i.id}/${action}${action==='return'?`?loan=${encodeURIComponent(i.loan_id!)}`:''}`,{method:'POST',redirect:'error'});
      if(!r.ok){if(r.status===409){await load();message.textContent='貸出状況が変わりました。最新の状態をご確認ください。';return;}throw new Error();}
      await load();message.textContent=action==='borrow'?'貸出が完了しました。「読む」から閲覧できます。':'返却しました。';
    }catch{message.textContent='処理を確認できませんでした。再読み込みして貸出状況をご確認ください。';retry.hidden=false;}
    finally{button.disabled=false;}
  }
  async function load(){
    if(loading)return;loading=true;retry.hidden=true;
    try{const r=await fetch(member?'/api/students/library':'/api/library/catalog',{cache:'no-store',redirect:'error'});if(!r.ok)throw new Error();const data=await r.json();items=data.items;render();}
    catch{message.textContent='資料を取得できませんでした。ログイン状態をご確認のうえ、再読み込みしてください。';retry.hidden=false;}
    finally{loading=false;}
  }
  search.addEventListener('input',render);kind.addEventListener('change',render);status.addEventListener('change',render);retry.onclick=()=>void load();
  void load();setInterval(()=>{if(!document.hidden)void load();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
}
