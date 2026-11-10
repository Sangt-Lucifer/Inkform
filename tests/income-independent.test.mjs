// Independent edge-case review of the income module (ported from the website archive, 2026-11-06).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncomeStore, selectIncome, summarizeIncome, validateIncomeBackup, incomeCsv, createIncomeFeature, INCOME_KEY } from '../src/income.js';
const r=(changes={})=>({id:'one', date:'2026-11-06', artist:'Alex', customer:'Independent Test', totalCents:50000, depositCents:10000, source:'first.pdf', updatedAt:'2026-11-06T12:00:00.000Z', ...changes});
function mem(){let raw=null;return {getItem:()=>raw,setItem:(k,v)=>{assert.equal(k,INCOME_KEY);raw=v}}}
test('10000 highest allowed values remain exact; deposits never enter total',()=>{
 const rows=Array.from({length:10000},(_,i)=>r({id:'i'+i,totalCents:999999999,depositCents:999999999}));
 assert.equal(validateIncomeBackup({schemaVersion:1,records:rows}).length,10000);
 assert.deepEqual(summarizeIncome(rows),{totalCents:9999999990000,open:0,count:10000});
});
test('failed update and failed merge preserve original byte-for-byte storage',()=>{
 const storage=mem(), s=createIncomeStore(storage);s.add(r());const original=storage.getItem();const originalSet=storage.setItem;
 storage.setItem=()=>{throw Error('QuotaExceededError')};
 assert.throws(()=>s.update(r({totalCents:60000,updatedAt:'2026-11-07T12:00:00Z'}),r().updatedAt));
 assert.equal(storage.getItem(),original);
 assert.throws(()=>s.merge({schemaVersion:1,records:[r({id:'two'})]}));assert.equal(storage.getItem(),original);
 storage.setItem=originalSet;
});
test('storage change detected before write preserves the other window data',()=>{
 const storage=mem(),s=createIncomeStore(storage);s.add(r());const read=storage.getItem;let reads=0;
 const other=JSON.stringify({schemaVersion:1,records:[r({id:'other'})]});
 storage.getItem=()=>++reads===2?other:read();let writes=0;storage.setItem=()=>writes++;
 assert.throws(()=>s.add(r({id:'two'})),/anderen Fenster/);assert.equal(writes,0);
});
test('invalid record midway in merge writes nothing',()=>{
 const storage=mem(),s=createIncomeStore(storage);s.add(r());const original=storage.getItem();
 assert.throws(()=>s.merge({schemaVersion:1,records:[r({id:'new'}),r({id:'invalid',date:'2026-02-29'})]}));
 assert.equal(storage.getItem(),original);
});
test('only projected financial keys survive a valid import',()=>{
 const s=createIncomeStore(mem());s.merge({schemaVersion:1,health:'ignored',records:[r()]});
 assert.equal('health' in s.list()[0],false);assert.equal(s.list()[0].customer,'Independent Test');
});
test('combined Unicode-normalized artist/month/year filters work after validation',()=>{
 const s=createIncomeStore(mem());s.add(r({artist:' Jose\u0301 '}));s.add(r({id:'two',date:'2025-11-06',artist:'José'}));
 assert.equal(selectIncome(s.list(),{artist:'JOSÉ',year:'2026',month:'11'}).length,1);
});
test('CSV accurately preserves open values, cents, zero, quote escaping and total',()=>{
 const csv=incomeCsv([r({customer:'A; "B"',totalCents:null,depositCents:2000}),r({id:'zero',totalCents:0,depositCents:0}),r({id:'small',totalCents:101,depositCents:50})]);
 assert.match(csv,/"A; ""B""";"";"20,00";"Preis offen"/);
 assert.match(csv,/"Summe der bekannten Gesamtpreise EUR";"";"";"1,01";"";"1 Preise offen"/);
});
test('literal reserved-looking artists and unassigned rows remain separate',()=>{
 const rows=validateIncomeBackup({schemaVersion:1,records:[r({artist:'__unassigned__'}),r({id:'blank',artist:''}),r({id:'literal',artist:'unassigned'}),r({id:'prefix',artist:'artist:Alex'})]});
 assert.deepEqual(selectIncome(rows,{artist:'__unassigned__'}).map(r=>r.id),['one']);
 assert.deepEqual(selectIncome(rows,{unassigned:true}).map(r=>r.id),['blank']);
 assert.deepEqual(selectIncome(rows,{artist:'unassigned'}).map(r=>r.id),['literal']);
 assert.deepEqual(selectIncome(rows,{artist:'artist:Alex'}).map(r=>r.id),['prefix']);
});
test('same row remains idempotent but changed price/source/time throws without writing',()=>{
 const storage=mem(),s=createIncomeStore(storage);s.add(r());const original=storage.getItem();
 s.add(r());assert.equal(s.list().length,1);
 for(const change of [{totalCents:75000},{source:'replacement.pdf'},{updatedAt:'2026-11-06T13:00:00Z'}]){
 assert.throws(()=>s.add(r(change)),/abweichender Eintrag/);assert.equal(storage.getItem(),original);
 }
});
test('editing selected artist casing preserves the selected dropdown option',()=>{
 const storage=mem(),store=createIncomeStore(storage);store.add(r());store.add(r({id:'other',artist:'Robin'}));
 const listeners={}; const admin={addEventListener:(type,fn)=>listeners[type]=fn};
 const host={innerHTML:''}; const form={addEventListener:()=>{}};
 const element=()=>({setAttribute:()=>{},querySelector:()=>form,querySelectorAll:()=>[],addEventListener:()=>{},close:()=>{}});
 globalThis.document={createElement:element,body:{append:()=>{}},getElementById:id=>id==='admin-app'?admin:host};
 globalThis.window={addEventListener:()=>{}};
 const feature=createIncomeFeature({storage,escape:s=>s,money:c=>String(c),parseMoney:Number,today:()=>'2026-11-06',notify:()=>{},download:()=>{},showReport:()=>{},isUnlocked:()=>true});
 listeners.change({target:{id:'income-filter-artist',value:'artist:Alex'}});
 store.update(r({artist:'ALEX',updatedAt:'2026-11-06T14:00:00Z'}),r().updatedAt);
 const html=feature.view(); const select=html.match(/<select id="income-filter-artist">(.*?)<\/select>/s)[1];
 assert.match(select,/value="artist:ALEX" selected/);assert.equal((select.match(/ selected/g)||[]).length,1);
 assert.match(html,/<strong>1<small>Einwilligungen/); // All would have shown 2
 delete globalThis.document;delete globalThis.window;
});
