/* 共用計算：國農曆換算與牌號公式 */
'use strict';let LM=null,tarotCards=null;const $=id=>document.getElementById(id);
const ds=n=>String(n).split('').reduce((a,c)=>a+Number(c),0);
const once=n=>n>21?n-22:n;
const helperNo=n=>once(n+5);
const pad=n=>String(n).padStart(2,'0');
const parse=s=>{const [y,m,d]=s.split('-').map(Number);return {y,m,d}};
const iso=d=>`${d.y}-${pad(d.m)}-${pad(d.d)}`;
const fmt=d=>`${d.y} 年 ${d.m} 月 ${d.d} 日`;
const fmtL=d=>`${d.y} 年 ${d.leap?'閏 ':''}${d.m} 月 ${d.d} 日`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const EPOCH=Date.UTC(1900,0,1);
function toLunar(s){if(!LM||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<LM.range[0]||s>LM.range[1])return null;const g=parse(s);const n=Math.round((Date.UTC(g.y,g.m-1,g.d)-EPOCH)/864e5);const ms=LM.months;let lo=0,hi=ms.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(ms[mid][0]<=n)lo=mid;else hi=mid-1}const [st,y,m,leap]=ms[lo];return {y,m,d:n-st+1,leap:!!leap}}
const card=n=>tarotCards?.[String(n)]||null;
const cardName=n=>card(n)?.name||'尚無對應牌卡';
const flowTag=n=>`<span class="${isAlert(n)?'alerttag':''}">${n}・${esc(cardName(n))}</span>`;
/* 流年、流月、流日特別標示：13 死神、16 高塔 */
const ALERT=new Set([13,16]);const isAlert=n=>ALERT.has(Number(n));
const stat=(label,val,showCard=true,flow=false)=>`<div class="stat${flow&&isAlert(val)?' alert':''}"><small>${esc(label)}</small><b>${esc(val)}</b>${showCard&&card(val)?`<span class="cardname">${esc(cardName(val))}</span>`:''}</div>`;
const explain=(n,kind='full',flow=false)=>{const c=card(n);if(!c)return `<div class="notice">數字 ${esc(n)} 尚無牌意對應。</div>`;return `<details class="meaning${flow&&isAlert(n)?' alert':''}"><summary><strong>${esc(n)}・${esc(c.name)}</strong><span>查看牌意</span></summary><div class="meaningbody"><p><b>牌意：</b>${esc(c.meaning)}</p><p><b>正位：</b>${esc(c.upright)}</p><p><b>逆位：</b>${esc(c.reversed)}</p>${kind==='trait'?`<p><b>正面特質：</b>${esc(c.positive)}</p><p><b>負面特質：</b>${esc(c.negative)}</p>`:''}</div></details>`};
const detailSet=(pairs,kind)=>pairs.map(([label,n])=>`<div class="detailrow"><span>${esc(label)}</span>${explain(n,kind)}</div>`).join('');
const pairPanels=(title,sp,lp,kind)=>`<div class="panel"><h3>☀ 國曆${title}</h3>${detailSet(sp,kind)}</div><div class="panel"><h3>☾ 農曆${title}</h3>${detailSet(lp,kind)}</div>`;
/* 本命：E3/J3 本性、E5/J5 外顯、E6/J6 內心 */
function base(d){const sum=ds(d.y+d.m+d.d);const t=parseInt(String(d.y).slice(-2),10);return {sum,nature:t>21?ds(t):t,outer:once(sum),inner:sum>21?ds(sum):sum}}
/* 流年：年份 + 生日月日（O/S 欄） */
const annual=(d,year)=>once(ds(year+d.m+d.d));
/* 流月：出生年月日 + 流年 + 國曆月（X/AB 欄）；農曆用農曆出生年月日 */
const monthNo=(d,year,m)=>once(ds(d.y+d.m+d.d+year+m));
/* 流日：再加國曆日（AI/AM 欄） */
const dayNo=(d,day)=>once(ds(d.y+d.m+d.d+day.y+day.m+day.d));
const triple=b=>[['本性',b.nature],['外顯',b.outer],['內心',b.inner]];
const todayIso=()=>{const t=new Date();return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`};
function loadData(){return Promise.all([fetch('./lunar-months.json').then(r=>{if(!r.ok)throw Error('農曆資料 HTTP '+r.status);return r.json()}),fetch('./tarot-meanings.json').then(r=>{if(!r.ok)throw Error('牌意資料 HTTP '+r.status);return r.json()})]).then(([data,cards])=>{LM=data;tarotCards=cards})}
