/**
 * Elyra UI kit for mini-apps – injected into every sandboxed app.
 *
 * Gives generated apps a consistent, professional look without the model having to
 * invent styles: layout, cards, KPI tiles, tabs, forms, tables, badges, empty states –
 * and SVG charts (donut, bars, line, sparkline) with legend, hover tooltip and labels.
 *
 * Chart colours: validated categorical palette (8 slots, fixed order, light + dark
 * steps; checked with the dataviz validator against Elyra's surfaces #ffffff / #171a2e).
 * Light slots aqua/yellow/magenta are below 3:1 on white → charts always show
 * visible labels/legends (relief rule). Status colours are reserved for good/bad deltas.
 */

export const KIT_CSS = `
:root{--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--series-5:#e87ba4;--series-6:#008300;--series-7:#6250d6;--series-8:#e34948;--good:#0ca30c;--critical:#d03b3b;--warning:#fab219;--radius:14px;--shadow:0 1px 2px color-mix(in srgb,var(--text) 6%,transparent),0 8px 24px color-mix(in srgb,var(--text) 6%,transparent)}
:root[data-theme="dark"]{--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--series-5:#d55181;--series-6:#0ca30c;--series-7:#9085e9;--series-8:#e66767;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.25)}
body{-webkit-font-smoothing:antialiased;letter-spacing:-.005em}
.e-app{max-width:1100px;margin:0 auto;padding:20px 20px 28px;display:flex;flex-direction:column;gap:16px}
.e-header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.e-title{font-size:20px;font-weight:650;letter-spacing:-.02em;margin:0}
.e-sub{font-size:12.5px;color:var(--muted);margin:2px 0 0}
.e-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.e-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(var(--min,220px),1fr))}
.e-grid-2{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.e-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow);min-width:0}
.e-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.e-card-title{font-size:13px;font-weight:600;margin:0}
.e-card-sub{font-size:11.5px;color:var(--muted);margin:2px 0 0}
.e-kpi{display:flex;flex-direction:column;gap:6px}
.e-kpi-label{font-size:11.5px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.e-kpi-value{font-size:26px;font-weight:650;letter-spacing:-.025em;font-variant-numeric:tabular-nums;line-height:1.1}
.e-delta{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.e-delta.up{color:var(--good)}.e-delta.down{color:var(--critical)}.e-delta.flat{color:var(--muted)}
.e-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:color-mix(in srgb,var(--text) 5%,transparent);border:1px solid var(--border)}
.e-tab{border:0;background:transparent;padding:6px 12px;border-radius:9px;font-size:12.5px;font-weight:550;color:var(--muted);cursor:pointer}
.e-tab:hover{color:var(--text)}.e-tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 3px color-mix(in srgb,var(--text) 12%,transparent)}
.e-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;font-weight:550;cursor:pointer;transition:background .15s,border-color .15s,transform .05s}
.e-btn:hover{border-color:color-mix(in srgb,var(--text) 25%,transparent)}.e-btn:active{transform:translateY(1px)}
.e-btn.primary{background:var(--accent);border-color:transparent;color:#fff}.e-btn.primary:hover{filter:brightness(1.08)}
.e-btn.ghost{background:transparent;border-color:transparent;color:var(--muted)}.e-btn.ghost:hover{color:var(--text);background:color-mix(in srgb,var(--text) 6%,transparent)}
.e-btn.danger{color:var(--critical)}.e-btn.sm{height:28px;padding:0 10px;font-size:12px;border-radius:8px}
.e-btn:disabled{opacity:.5;cursor:not-allowed}
.e-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.e-label{font-size:12px;font-weight:550;color:var(--muted)}
.e-input,.e-select,.e-textarea{width:100%;height:36px;padding:0 11px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13.5px;outline:none;transition:border-color .15s,box-shadow .15s}
.e-textarea{height:auto;min-height:84px;padding:9px 11px;resize:vertical}
.e-input:focus,.e-select:focus,.e-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.e-form{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end}
.e-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:12px}
.e-table{width:100%;border-collapse:collapse;font-size:13px}
.e-table th{position:sticky;top:0;background:var(--surface);text-align:left;font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:10px 12px;border-bottom:1px solid var(--border)}
.e-table td{padding:10px 12px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent)}
.e-table tr:last-child td{border-bottom:0}.e-table tbody tr:hover td{background:color-mix(in srgb,var(--text) 3%,transparent)}
.e-table .num,.num{text-align:right;font-variant-numeric:tabular-nums}
.e-badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:550;background:color-mix(in srgb,var(--text) 7%,transparent);color:var(--text)}
.e-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.e-pos{color:var(--good)}.e-neg{color:var(--critical)}.e-muted{color:var(--muted)}
.e-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;padding:32px 16px;color:var(--muted);font-size:13px}
.e-empty-icon{font-size:28px;opacity:.85}
.e-progress{height:8px;border-radius:999px;background:color-mix(in srgb,var(--text) 8%,transparent);overflow:hidden}
.e-progress>span{display:block;height:100%;border-radius:999px;background:var(--accent);transition:width .4s ease}
.e-progress.warn>span{background:var(--warning)}.e-progress.over>span{background:var(--critical)}
.e-dropzone{border:1.5px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted);cursor:pointer;transition:border-color .15s,background .15s}
.e-dropzone:hover,.e-dropzone.drag{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent);color:var(--text)}
.e-list{display:flex;flex-direction:column}.e-list-item{display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent)}.e-list-item:last-child{border-bottom:0}
.e-note{font-size:11.5px;color:var(--muted);text-align:center;padding-top:4px}
.e-chart{position:relative;width:100%;height:auto!important;min-height:0}.e-chart svg{display:block;width:100%;height:auto;overflow:visible}
.e-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:12px;color:var(--muted)}
.e-legend-item{display:inline-flex;align-items:center;gap:6px}.e-legend-item b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
.e-legend-swatch{width:10px;height:10px;border-radius:3px;flex:none}.e-legend-line{width:14px;height:2px;border-radius:2px;flex:none}
.e-tip{position:fixed;z-index:50;pointer-events:none;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:8px 10px;font-size:12px;box-shadow:var(--shadow);opacity:0;transition:opacity .1s;min-width:120px}
.e-tip.show{opacity:1}.e-tip-title{color:var(--muted);font-size:11px;margin-bottom:4px}.e-tip-row{display:flex;align-items:center;gap:8px;justify-content:space-between}
.e-tip-row b{font-variant-numeric:tabular-nums}.e-tip-key{display:inline-flex;align-items:center;gap:6px;color:var(--muted)}
.e-axis{font-size:10.5px;fill:var(--muted)}.e-grid-line{stroke:var(--border);stroke-width:1}
@media (max-width:520px){.e-app{padding:14px}.e-kpi-value{font-size:22px}}
`;

/** Plain ES2017 – runs inside the sandbox, no dependencies. */
export const KIT_JS = `(function(){
var SERIES=8;
function color(i){return 'var(--series-'+((i%SERIES)+1)+')';}
var NS='http://www.w3.org/2000/svg';
function el(tag,attrs,parent){var n=document.createElementNS(NS,tag);for(var k in attrs){if(attrs[k]!==undefined&&attrs[k]!==null)n.setAttribute(k,attrs[k]);}if(parent)parent.appendChild(n);return n;}
function host(target){var h=typeof target==='string'?document.querySelector(target):target;if(!h)throw new Error('elyra.chart: Ziel-Element nicht gefunden');h.innerHTML='';h.classList.add('e-chart');h.style.height='auto';h.style.maxHeight='none';h.style.overflow='visible';var card=h.closest&&h.closest('.e-card');if(card){card.style.height='auto';card.style.maxHeight='none';}return h;}
var fmt={
  eur:function(n,dec){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',minimumFractionDigits:dec===undefined?2:dec,maximumFractionDigits:dec===undefined?2:dec}).format(Number(n)||0);},
  num:function(n,dec){return new Intl.NumberFormat('de-DE',{minimumFractionDigits:dec||0,maximumFractionDigits:dec||0}).format(Number(n)||0);},
  pct:function(n,dec){return new Intl.NumberFormat('de-DE',{style:'percent',minimumFractionDigits:dec||0,maximumFractionDigits:dec===undefined?1:dec}).format(Number(n)||0);},
  compact:function(n){return new Intl.NumberFormat('de-DE',{notation:'compact',maximumFractionDigits:1}).format(Number(n)||0);},
  date:function(d){var x=d instanceof Date?d:new Date(d);return isNaN(x)?String(d):x.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});},
  month:function(d){var x=d instanceof Date?d:new Date(d);return isNaN(x)?String(d):x.toLocaleDateString('de-DE',{month:'short',year:'2-digit'});}
};
var tip=null;
function tooltip(){if(!tip){tip=document.createElement('div');tip.className='e-tip';document.body.appendChild(tip);}return tip;}
function showTip(x,y,title,rows){var t=tooltip();t.textContent='';if(title){var h=document.createElement('div');h.className='e-tip-title';h.textContent=title;t.appendChild(h);}rows.forEach(function(r){var row=document.createElement('div');row.className='e-tip-row';var key=document.createElement('span');key.className='e-tip-key';if(r.color){var s=document.createElement('span');s.className=r.line?'e-legend-line':'e-legend-swatch';s.style.background=r.color;key.appendChild(s);}key.appendChild(document.createTextNode(r.label||''));var v=document.createElement('b');v.textContent=r.value;row.appendChild(key);row.appendChild(v);t.appendChild(row);});t.classList.add('show');var w=t.offsetWidth,hh=t.offsetHeight;var left=Math.min(window.innerWidth-w-8,x+14),top=Math.max(8,y-hh-10);t.style.left=left+'px';t.style.top=top+'px';}
function hideTip(){if(tip)tip.classList.remove('show');}
function legend(h,items,kind){var lg=document.createElement('div');lg.className='e-legend';items.forEach(function(it){var i=document.createElement('span');i.className='e-legend-item';var s=document.createElement('span');s.className=kind==='line'?'e-legend-line':'e-legend-swatch';s.style.background=it.color;i.appendChild(s);i.appendChild(document.createTextNode(it.label));if(it.value!==undefined){var b=document.createElement('b');b.textContent=it.value;i.appendChild(document.createTextNode(' '));i.appendChild(b);}lg.appendChild(i);});h.appendChild(lg);}
function niceMax(v){if(v<=0)return 1;var p=Math.pow(10,Math.floor(Math.log10(v)));var n=v/p;var m=n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10;return m*p;}

/** Donut: data=[{label,value}], opts={format, center, centerLabel, max:8} */
function donut(target,data,opts){opts=opts||{};var f=opts.format||fmt.num;var h=host(target);
  var items=(data||[]).filter(function(d){return Number(d.value)>0;}).sort(function(a,b){return b.value-a.value;});
  if(!items.length){h.innerHTML='<div class="e-empty"><div class="e-empty-icon">◔</div>Noch keine Daten</div>';return;}
  var max=opts.max||7;if(items.length>max){var rest=items.slice(max-1).reduce(function(s,d){return s+Number(d.value);},0);items=items.slice(0,max-1).concat([{label:'Sonstige',value:rest}]);}
  var total=items.reduce(function(s,d){return s+Number(d.value);},0);
  var size=220,r=96,w=26,cx=size/2,cy=size/2;var svg=el('svg',{viewBox:'0 0 '+size+' '+size,role:'img','aria-label':opts.ariaLabel||'Anteile'},h);svg.style.maxWidth='240px';svg.style.margin='0 auto';
  var a0=-Math.PI/2;var gap=items.length>1?0.012:0;
  items.forEach(function(d,i){var frac=Number(d.value)/total;var a1=a0+frac*Math.PI*2;var s=a0+gap,e=a1-gap;if(e<=s){a0=a1;return;}var large=e-s>Math.PI?1:0;
    var p='M'+(cx+r*Math.cos(s))+' '+(cy+r*Math.sin(s))+' A'+r+' '+r+' 0 '+large+' 1 '+(cx+r*Math.cos(e))+' '+(cy+r*Math.sin(e));
    var path=el('path',{d:p,fill:'none',stroke:d.color||color(i),'stroke-width':w,'stroke-linecap':'butt',tabindex:0},svg);path.style.cursor='pointer';path.style.transition='opacity .15s';
    var rows=[{label:d.label,value:f(d.value),color:d.color||color(i)},{label:'Anteil',value:fmt.pct(frac)}];
    path.addEventListener('pointermove',function(ev){showTip(ev.clientX,ev.clientY,null,rows);svg.querySelectorAll('path').forEach(function(q){q.style.opacity=q===path?'1':'.45';});});
    path.addEventListener('pointerleave',function(){hideTip();svg.querySelectorAll('path').forEach(function(q){q.style.opacity='1';});});
    a0=a1;});
  var t1=el('text',{x:cx,y:cy-2,'text-anchor':'middle','font-size':'20','font-weight':'650',fill:'var(--text)'},svg);t1.textContent=opts.center!==undefined?opts.center:f(total);
  var t2=el('text',{x:cx,y:cy+18,'text-anchor':'middle','font-size':'11.5',fill:'var(--muted)'},svg);t2.textContent=opts.centerLabel||'Gesamt';
  legend(h,items.map(function(d,i){return{label:d.label,value:f(d.value),color:d.color||color(i)};}),'swatch');}

/** Bars: data=[{label,value}] or series form {labels:[...], series:[{name,values,color?}]}; opts={format,horizontal,height} */
function bars(target,data,opts){opts=opts||{};var f=opts.format||fmt.num;var h=host(target);
  var labels,series;if(Array.isArray(data)){labels=data.map(function(d){return d.label;});series=[{name:opts.name||'',values:data.map(function(d){return Number(d.value)||0;}),colors:data.map(function(d){return d.color;})}];}else{labels=data.labels||[];series=data.series||[];}
  if(!labels.length){h.innerHTML='<div class="e-empty"><div class="e-empty-icon">▥</div>Noch keine Daten</div>';return;}
  var all=[];series.forEach(function(s){all=all.concat(s.values.map(Number));});var maxV=niceMax(Math.max.apply(null,all.concat([0])));
  if(opts.horizontal){var rowH=30,W=600,labelW=140,pad=70;var H=labels.length*rowH+8;var svg=el('svg',{viewBox:'0 0 '+W+' '+H},h);
    labels.forEach(function(lab,i){var v=Number(series[0].values[i])||0;var y=i*rowH+4;var bw=Math.max(v>0?4:0,(W-labelW-pad)*v/maxV);
      var tl=el('text',{x:labelW-10,y:y+rowH/2+4,'text-anchor':'end',class:'e-axis'},svg);tl.textContent=String(lab).length>20?String(lab).slice(0,19)+'…':lab;tl.style.fill='var(--text)';tl.style.fontSize='12px';
      var c=(series[0].colors&&series[0].colors[i])||series[0].color||color(opts.colorIndex||0);
      var bar=el('rect',{x:labelW,y:y+6,width:bw,height:rowH-12,rx:4,fill:c},svg);bar.style.cursor='pointer';
      var vt=el('text',{x:labelW+bw+8,y:y+rowH/2+4,class:'e-axis'},svg);vt.textContent=f(v);vt.style.fill='var(--text)';vt.style.fontWeight='600';
      bar.addEventListener('pointermove',function(ev){showTip(ev.clientX,ev.clientY,lab,[{label:series[0].name||'Wert',value:f(v),color:c}]);bar.style.filter='brightness(1.12)';});
      bar.addEventListener('pointerleave',function(){hideTip();bar.style.filter='';});});return;}
  var W=600,H=opts.height||240,L=52,R=8,T=12,B=26;var svg2=el('svg',{viewBox:'0 0 '+W+' '+H},h);var iw=W-L-R,ih=H-T-B;
  for(var g=0;g<=4;g++){var gy=T+ih-ih*g/4;el('line',{x1:L,x2:W-R,y1:gy,y2:gy,class:'e-grid-line'},svg2);var at=el('text',{x:L-8,y:gy+3.5,'text-anchor':'end',class:'e-axis'},svg2);at.textContent=fmt.compact(maxV*g/4);}
  var groupW=iw/labels.length;var n=series.length;var bw2=Math.min(36,(groupW-10)/n-2);
  labels.forEach(function(lab,i){var gx=L+groupW*i+(groupW-(bw2+2)*n+2)/2;
    var xt=el('text',{x:L+groupW*i+groupW/2,y:H-8,'text-anchor':'middle',class:'e-axis'},svg2);xt.textContent=lab;
    var hit=el('rect',{x:L+groupW*i,y:T,width:groupW,height:ih,fill:'transparent'},svg2);
    series.forEach(function(s,k){var v=Number(s.values[i])||0;var bh=ih*v/maxV;var c=(s.colors&&s.colors[i])||s.color||color(k);
      if(bh>0){var x=gx+k*(bw2+2),y=T+ih-bh;var rr=Math.min(4,bh);el('path',{d:'M'+x+' '+(T+ih)+' V'+(y+rr)+' Q'+x+' '+y+' '+(x+rr)+' '+y+' H'+(x+bw2-rr)+' Q'+(x+bw2)+' '+y+' '+(x+bw2)+' '+(y+rr)+' V'+(T+ih)+' Z',fill:c},svg2);}});
    hit.addEventListener('pointermove',function(ev){showTip(ev.clientX,ev.clientY,lab,series.map(function(s,k){return{label:s.name||'Wert',value:f(s.values[i]),color:(s.colors&&s.colors[i])||s.color||color(k)};}));hit.setAttribute('fill','color-mix(in srgb, var(--text) 5%, transparent)');});
    hit.addEventListener('pointerleave',function(){hideTip();hit.setAttribute('fill','transparent');});});
  if(n>1)legend(h,series.map(function(s,k){return{label:s.name,color:s.color||color(k)};}),'swatch');}

/** Line: {labels:[...], series:[{name, values, color?}]}, opts={format,height,area} */
function line(target,data,opts){opts=opts||{};var f=opts.format||fmt.num;var h=host(target);var labels=data.labels||[];var series=data.series||[];
  if(labels.length<2){h.innerHTML='<div class="e-empty"><div class="e-empty-icon">📈</div>Zu wenig Daten für einen Verlauf</div>';return;}
  var all=[];series.forEach(function(s){all=all.concat(s.values.map(Number));});var minV=Math.min(0,Math.min.apply(null,all));var maxV=niceMax(Math.max.apply(null,all.concat([0])));
  var W=600,H=opts.height||240,L=52,R=12,T=12,B=26;var svg=el('svg',{viewBox:'0 0 '+W+' '+H},h);var iw=W-L-R,ih=H-T-B;
  function X(i){return L+iw*i/(labels.length-1);}function Y(v){return T+ih-(ih*(v-minV)/(maxV-minV||1));}
  for(var g=0;g<=4;g++){var val=minV+(maxV-minV)*g/4;var gy=Y(val);el('line',{x1:L,x2:W-R,y1:gy,y2:gy,class:'e-grid-line'},svg);var at=el('text',{x:L-8,y:gy+3.5,'text-anchor':'end',class:'e-axis'},svg);at.textContent=fmt.compact(val);}
  var step=Math.ceil(labels.length/8);labels.forEach(function(lab,i){if(i%step!==0&&i!==labels.length-1)return;var t=el('text',{x:X(i),y:H-8,'text-anchor':'middle',class:'e-axis'},svg);t.textContent=lab;});
  series.forEach(function(s,k){var c=s.color||color(k);var d=s.values.map(function(v,i){return(i?'L':'M')+X(i)+' '+Y(Number(v)||0);}).join(' ');
    if(opts.area&&series.length===1){el('path',{d:d+' L'+X(labels.length-1)+' '+Y(minV)+' L'+X(0)+' '+Y(minV)+' Z',fill:c,opacity:.12},svg);}
    el('path',{d:d,fill:'none',stroke:c,'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
    var li=s.values.length-1;el('circle',{cx:X(li),cy:Y(Number(s.values[li])||0),r:4,fill:c,stroke:'var(--surface)','stroke-width':2},svg);});
  var cross=el('line',{y1:T,y2:T+ih,stroke:'var(--muted)','stroke-width':1,'stroke-dasharray':'3 3',opacity:0},svg);
  var dots=series.map(function(s,k){return el('circle',{r:4.5,fill:s.color||color(k),stroke:'var(--surface)','stroke-width':2,opacity:0},svg);});
  var hit=el('rect',{x:L,y:T,width:iw,height:ih,fill:'transparent'},svg);
  hit.addEventListener('pointermove',function(ev){var box=svg.getBoundingClientRect();var px=(ev.clientX-box.left)*(W/box.width);var i=Math.max(0,Math.min(labels.length-1,Math.round((px-L)/iw*(labels.length-1))));
    cross.setAttribute('x1',X(i));cross.setAttribute('x2',X(i));cross.setAttribute('opacity',1);
    dots.forEach(function(dt,k){dt.setAttribute('cx',X(i));dt.setAttribute('cy',Y(Number(series[k].values[i])||0));dt.setAttribute('opacity',1);});
    showTip(ev.clientX,ev.clientY,labels[i],series.map(function(s,k){return{label:s.name||'Wert',value:f(s.values[i]),color:s.color||color(k),line:true};}));});
  hit.addEventListener('pointerleave',function(){hideTip();cross.setAttribute('opacity',0);dots.forEach(function(dt){dt.setAttribute('opacity',0);});});
  if(series.length>1)legend(h,series.map(function(s,k){return{label:s.name,color:s.color||color(k)};}),'line');}

/** Sparkline for KPI tiles: values=[...] */
function spark(target,values,opts){opts=opts||{};var h=host(target);var v=(values||[]).map(Number);if(v.length<2)return;var W=120,H=32;var mn=Math.min.apply(null,v),mx=Math.max.apply(null,v);var svg=el('svg',{viewBox:'0 0 '+W+' '+H,preserveAspectRatio:'none'},h);svg.style.height='32px';
  var d=v.map(function(x,i){return(i?'L':'M')+(W*i/(v.length-1))+' '+(H-2-(H-4)*(x-mn)/((mx-mn)||1));}).join(' ');el('path',{d:d,fill:'none',stroke:opts.color||'var(--accent)','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke'},svg);}

/** Delta badge text: delta(current, previous, {invert}) → {text, cls} */
function delta(cur,prev,opts){opts=opts||{};cur=Number(cur)||0;prev=Number(prev)||0;if(!prev)return{text:'–',cls:'flat'};var ch=(cur-prev)/Math.abs(prev);var good=opts.invert?ch<0:ch>0;var arrow=ch>0?'▲':ch<0?'▼':'■';return{text:arrow+' '+fmt.pct(Math.abs(ch)),cls:Math.abs(ch)<0.005?'flat':good?'up':'down'};}

window.elyra=window.elyra||{};window.elyra.fmt=fmt;window.elyra.chart={donut:donut,bars:bars,line:line,spark:spark,color:color};window.elyra.delta=delta;
window.addEventListener('scroll',hideTip,true);
})();`;
