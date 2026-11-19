import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {originalLink,reviewPayload} from '../assets/ui.mjs';
test('download links reject traversal and unsafe IDs',()=>{
  assert.equal(originalLink(12),'download.php?id=12');
  for(const x of ['../config.php',0,-1,Infinity,1.2]) assert.throws(()=>originalLink(x));
});
test('review payload preserves provision dates, not client role claims',()=>{
  const p=reviewPayload(4,{source_date:'2026-11-19',effective_from:'2026-01-01',effective_to:'',
    source_url:'',provisions:JSON.stringify([{body:'Текст',locator:'п. 1',effective_from:'2026-02-01',effective_to:null}]),admin:true});
  assert.equal(p.provisions[0].effective_from,'2026-02-01'); assert.equal(p.admin,undefined);
  assert.throws(()=>reviewPayload(1,{provisions:'{}'}));
});
test('frontend has no unsafe document HTML sinks',()=>{
  const js=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(js,/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/);
  assert.match(js,/textContent/); assert.match(js,/credentials:'same-origin'/);
});
test('PHP entrypoints include central authentication',()=>{
  for(const file of ['index.php','api.php','download.php','install.php']){
    assert.match(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),/require __DIR__ \. '\/src\/bootstrap\.php'/);
  }
  const api=readFileSync(new URL('../api.php',import.meta.url),'utf8');
  assert.match(api,/check_bitrix_sessid/); assert.match(api,/&& !\$isAdmin/);
});
