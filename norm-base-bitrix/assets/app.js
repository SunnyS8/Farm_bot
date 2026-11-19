async function start() {
  const {reviewPayload, originalLink} = await import('./ui.mjs');
  const admin = document.body.dataset.admin === '1';
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const notice = document.getElementById('notice');
  const el = (tag, text, parent) => {
    const n = document.createElement(tag); if (text !== undefined) n.textContent = String(text);
    if (parent) parent.append(n); return n;
  };
  async function api(action, form, id) {
    const options = {credentials:'same-origin'};
    if (form) { form.set('sessid', csrf); options.method='POST'; options.body=form; }
    const response = await fetch(`api.php?action=${encodeURIComponent(action)}${id ? `&id=${Number(id)}` : ''}`,options);
    let data; try {data=await response.json();} catch {throw new Error('Не удалось прочитать ответ. Проверьте авторизацию и установку.');}
    if (!response.ok) throw new Error(data.error || 'Ошибка запроса'); return data;
  }
  const payload = p => {const f=new FormData(); f.set('payload',JSON.stringify(p)); return f;};
  async function busy(form, work) {
    const button=form.querySelector('button'); if (button.disabled) return;
    button.disabled=true; notice.textContent='Выполняется…';
    try {await work();} catch(e) {notice.textContent=e.message;} finally {button.disabled=false;}
  }
  async function list() {
    const data=await api('list'); const target=document.getElementById('document-list'); target.replaceChildren();
    for (const doc of data.documents) {
      const tr=el('tr',undefined,target); el('td',doc.title,tr); el('td',doc.version_count,tr);
      el('button','Открыть',el('td',undefined,tr)).onclick=()=>detail(doc.id).catch(e=>{notice.textContent=e.message;});
    }
    if (!data.documents.length) el('td','Документов пока нет.',el('tr',undefined,target)).colSpan=3;
  }
  async function detail(id) {
    const data=await api('detail',null,id); document.getElementById('detail').hidden=false;
    document.getElementById('detail-title').textContent=`${data.document.title} · ID ${id}`;
    const target=document.getElementById('version-list'); target.replaceChildren();
    for (const v of data.versions) {
      const box=el('article',undefined,target); box.className='version';
      el('h3',`Редакция #${v.id} · ${v.original_name}`,box);
      el('span',({ready:'Проверена',pending_review:'Ожидает проверки',ocr_needed:'Требуется извлечение / OCR'})[v.status],box).className='badge';
      el('p',`Действие: ${v.effective_from || 'не установлено'} — ${v.effective_to || 'окончание не установлено'}; источник проверен: ${v.source_date || 'не установлен'}`,box);
      if (admin || v.status==='ready') el('a','Скачать оригинал',box).href=originalLink(v.id);
      el('small',` · SHA-256: ${v.sha256}`,box);
      for (const p of v.provisions) {el('h4',`${p.locator} · ${p.effective_from} — ${p.effective_to || 'окончание не установлено'}`,box); el('blockquote',p.body,box);}
      if (admin && v.status!=='ready') reviewForm(v,box,id);
    }
  }
  function reviewForm(v,parent,docId) {
    const d=el('details',undefined,parent); el('summary','Сверить и опубликовать фрагменты',d);
    el('p','Вставьте дословный текст после сверки с оригиналом. После публикации запись неизменяема; исправление — новая редакция.',d);
    if (v.extracted_text) el('pre',v.extracted_text,d);
    const f=el('form',undefined,d);
    for (const [name,label,type] of [['source_url','HTTPS источник (необязательно)','url'],['source_date','Дата проверки источника','date'],['effective_from','Редакция действует с (включительно)','date'],['effective_to','Действует по (включительно; пусто — не установлено)','date']]) {
      const n=el('input',undefined,el('label',label,f)); n.name=name; n.type=type; n.required=['source_date','effective_from'].includes(name);
    }
    const ta=el('textarea',undefined,el('label','Проверенные пункты: JSON, с отдельными датами',f)); ta.name='provisions'; ta.required=true; ta.rows=9;
    ta.value=JSON.stringify([{locator:'Статья 1, пункт 1, страница 1',body:'ВСТАВЬТЕ ДОСЛОВНЫЙ ПРОВЕРЕННЫЙ ТЕКСТ',effective_from:'',effective_to:null}],null,2);
    el('button','Подтвердить сверку и опубликовать',f);
    f.onsubmit=e=>{e.preventDefault(); busy(f,async()=>{
      const p=reviewPayload(v.id,Object.fromEntries(new FormData(f)));
      if (p.provisions.some(x=>x.body?.includes('ВСТАВЬТЕ ДОСЛОВНЫЙ'))) throw new Error('Замените шаблон реальным текстом.');
      await api('review',payload(p)); notice.textContent='Редакция опубликована.'; await detail(docId);
    });};
  }
  document.getElementById('refresh').onclick=()=>list().catch(e=>{notice.textContent=e.message;});
  const upload=document.getElementById('upload-form');
  if (upload) upload.onsubmit=e=>{e.preventDefault(); busy(upload,async()=>{
    const r=await api('upload',new FormData(upload)); upload.reset(); notice.textContent='Оригинал сохранён; требуется проверка.'; await list(); await detail(r.document_id);
  });};
  const ask=document.getElementById('ask-form'); ask.elements.date.value=new Date().toLocaleDateString('sv-SE');
  ask.onsubmit=e=>{e.preventDefault(); busy(ask,async()=>{
    const data=await api('ask',payload(Object.fromEntries(new FormData(ask))));
    const out=document.getElementById('answer'); out.replaceChildren(); el('p',data.notice,out);
    for (const c of data.citations) {
      el('h3',`${c.title} · ${c.locator}`,out); el('blockquote',c.quote,out);
      el('p',`Редакция #${c.version_id}; проверка: ${c.source_date}; пункт: ${c.effective_from} — ${c.effective_to || 'окончание не установлено'}`,out);
      el('a','Проверить оригинал',out).href=originalLink(c.version_id);
    }
    notice.textContent='Проверка цитат завершена.';
  });};
  await list();
}
start().catch(e=>{document.getElementById('notice').textContent=e.message;});
