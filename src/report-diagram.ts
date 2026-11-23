/**
 * Interactive diagrams for report.html: the editorial drawer's SVG is inlined (not an <img>) so a reader can hover or
 * focus a part to light its connections, click it for what the report says about it, step through the flow one stage
 * at a time, zoom and drag, and read every part's name on a plate beneath. Nothing here fetches anything; without
 * script the figure is the same static drawing, and in print the controls drop away.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface InteractiveInput {
	n: number;
	caption: string;
	svg: string;
	dark?: string;
	/** The report's prose with its diagram blocks removed, searched for a sentence about each part. */
	prose: string;
}

/** The first sentence of `prose` that names `label`, flattened to plain text, or "". */
export function sentenceAbout(label: string, prose: string): string {
	const needle = label.trim().toLowerCase();
	if (!needle) return "";
	for (const block of prose.split(/\n{2,}/)) {
		if (/^\s*(#|```|\||---)/.test(block)) continue;
		const text = block
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[*_`]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		for (const sentence of text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? []) {
			if (sentence.toLowerCase().includes(needle)) return sentence.trim().replace(/\s*\((?:derived[^)]*)\)/i, "");
		}
	}
	return "";
}

/** Give every id in one inlined SVG a prefix so two skins, or two figures, never collide on `url(#arrow)`. */
export function scopeIds(svg: string, prefix: string): string {
	return svg
		.replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}${id}"`)
		.replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}${id})`)
		.replace(/aria-labelledby="([^"]+)"/g, (_m, ids: string) => `aria-labelledby="${ids.split(/\s+/).map((i) => prefix + i).join(" ")}"`);
}

/** Node ids and labels in drawing order, read from the wrappers the drawer emits. */
export function partsOf(svg: string): Array<{ id: string; label: string }> {
	return [...svg.matchAll(/<g class="node" data-node="([^"]*)" data-label="([^"]*)"/g)].map((m) => ({ id: m[1]!, label: m[2]! }));
}

/** An interactive figure, or null when the diagram has no parts to point at (sequence, Mermaid fallbacks). */
export function interactiveFigure(input: InteractiveInput): string | null {
	const parts = partsOf(input.svg);
	if (parts.length === 0) return null;
	const skin = (svg: string, tag: string) => scopeIds(svg.replace("<svg ", '<svg class="dg" focusable="false" '), `f${input.n}${tag}-`);
	const light = `<div class="skin skin-light">${skin(input.svg, "l")}</div>`;
	const dark = input.dark && partsOf(input.dark).length === parts.length ? `<div class="skin skin-dark">${skin(input.dark, "d")}</div>` : "";
	const plate = parts
		.map((p) => `<li><button type="button" data-node="${p.id}" data-note="${esc(sentenceAbout(p.label, input.prose))}">${esc(p.label)}</button></li>`)
		.join("");
	return `<figure class="diagram ix" data-fig="${input.n}">
<div class="stage" tabindex="-1">${light}${dark}</div>
<div class="ctl" role="group" aria-label="Diagram controls"><button type="button" data-do="prev" aria-label="Previous step">&larr;</button><span class="stepno" aria-live="polite">All parts</span><button type="button" data-do="next" aria-label="Next step">&rarr;</button><button type="button" data-do="clear">Show all</button><span class="sep"></span><button type="button" data-do="out" aria-label="Zoom out">&minus;</button><button type="button" data-do="in" aria-label="Zoom in">+</button><button type="button" data-do="reset">Reset view</button></div>
<p class="note" aria-live="polite"></p>
<ol class="plate" aria-label="Parts">${plate}</ol>
<figcaption>${esc(input.caption)}</figcaption>
</figure>`;
}

export const DIAGRAM_CSS = `
.ix .stage{overflow:hidden;border-radius:4px;touch-action:pan-y}.ix .stage.zoomed{cursor:grab;touch-action:none}.ix .stage.drag{cursor:grabbing}
.ix .skin-dark{display:none}.ix svg.dg.fit .legend{display:none}.ix svg.dg{display:block;width:100%;height:auto;user-select:none}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .ix .skin-light{display:none}:root:not([data-theme=light]) .ix .skin-dark{display:block}}
:root[data-theme=dark] .ix .skin-light{display:none}:root[data-theme=dark] .ix .skin-dark{display:block}
.ix .ctl{display:none;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.7rem 0 0}.js .ix .ctl{display:flex}
.ix .ctl .sep{flex:1}.ix .stepno{font:500 .7rem var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--soft);min-width:7.5rem;text-align:center}
.ix button{font:500 .72rem var(--mono);letter-spacing:.04em;color:var(--ink);background:var(--paper);border:1px solid var(--rule);border-radius:4px;padding:.3rem .6rem;cursor:pointer}
.ix button:hover{border-color:var(--muted)}.ix button:focus-visible,.ix g.node:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ix button[aria-pressed=true]{border-color:var(--accent);background:var(--tint)}
.ix .note{min-height:2.6em;margin:.7rem 0 .2rem;font-size:.86rem;color:var(--muted)}.ix .note strong{color:var(--ink)}.ix .note .conn{font-family:var(--mono);font-size:.72rem;color:var(--soft);display:block}
.ix .plate{list-style:none;display:flex;flex-wrap:wrap;gap:.35rem;margin:.4rem 0 .6rem;padding:0}.ix .plate li{margin:0;padding:0}.ix .plate li::marker{content:""}
.ix figcaption{font-size:.82rem;color:var(--soft);margin-top:.5rem}
.js .ix g.node{cursor:pointer}.ix svg.focus g.node:not(.on),.ix svg.focus path:not(.on),.ix svg.focus g.lbl:not(.on){opacity:.28}
.ix svg.focus path.on{stroke:var(--ink);stroke-width:2}
.ix g.node.cur :is(rect,polygon):nth-of-type(2){stroke:var(--accent);stroke-width:2;fill:var(--tint)}
@media (max-width:52rem){.ix .ctl .sep{display:none}.ix button{padding:.45rem .7rem}}
@media print{.ix .ctl,.ix .note{display:none!important}.ix .skin-dark{display:none!important}.ix .skin-light{display:block!important}.ix svg.focus *{opacity:1!important}}`;

export const DIAGRAM_SCRIPT = `(function(){var root=document.documentElement;root.classList.add("js");
function $$(n,s){return [].slice.call(n.querySelectorAll(s))}
$$(document,"figure.ix").forEach(function(fig){
var svgs=$$(fig,"svg.dg"),first=svgs[0],stage=fig.querySelector(".stage"),note=fig.querySelector(".note"),stepno=fig.querySelector(".stepno");
var base=first.getAttribute("viewBox").split(" ").map(Number),view,scale=1;
(function(){for(var i=0;i<svgs.length;i++){var s=svgs[i],bg=s.querySelector(":scope>rect"),lg=s.querySelector(".legend");if(bg)bg.style.display="none";if(lg)lg.style.display="none";
var b;try{b=s.getBBox()}catch(e){b=null}if(bg)bg.style.display="";if(lg)lg.style.display="";
if(b&&b.width>0){base=[b.x-20,b.y-20,b.width+40,b.height+40];svgs.forEach(function(t){t.classList.add("fit")});break}}})();
view=base.slice();apply();
var ids=$$(first,"g.node").map(function(g){return g.dataset.node});
var label={};$$(first,"g.node").forEach(function(g){label[g.dataset.node]=g.dataset.label});
var edges=$$(first,"path[data-from]").map(function(p){var l=$$(first,"g.lbl").filter(function(g){return g.dataset.from===p.dataset.from&&g.dataset.to===p.dataset.to})[0];return{f:p.dataset.from,t:p.dataset.to,back:!!p.dataset.back,text:l?l.textContent.trim().toLowerCase():""}});
var order=(function(){var left=ids.slice(),done=[],fw=edges.filter(function(e){return!e.back&&label[e.f]&&label[e.t]});
while(left.length){var pick=left.filter(function(n){return fw.every(function(e){return e.t!==n||done.indexOf(e.f)>=0})})[0]||left[0];done.push(pick);left.splice(left.indexOf(pick),1)}return done})();
var sel=null,step=-1,hover=null;
function paint(nodes,lit,cur){svgs.forEach(function(s){s.classList.toggle("focus",!!nodes);
$$(s,"g.node").forEach(function(g){g.classList.toggle("on",!!nodes&&nodes.indexOf(g.dataset.node)>=0);g.classList.toggle("cur",cur===g.dataset.node)});
$$(s,"path[data-from],g.lbl").forEach(function(e){e.classList.toggle("on",!!nodes&&lit(e.dataset.from,e.dataset.to))})})}
function around(id){return[id].concat(edges.filter(function(e){return e.f===id||e.t===id}).map(function(e){return e.f===id?e.t:e.f}))}
function draw(){var id=hover||sel;
if(step>=0){var seen=order.slice(0,step+1);paint(seen,function(f,t){return seen.indexOf(f)>=0&&seen.indexOf(t)>=0},order[step]);return}
if(id){paint(around(id),function(f,t){return f===id||t===id},null);return}
paint(null,null,null)}
function words(list){return list.length?list.join(", "):""}
function describe(id){if(!id){note.textContent="";return}
var from=[],to=[];edges.forEach(function(e){if(e.t===id&&label[e.f])from.push(label[e.f]+(e.text?" ("+e.text+")":""));if(e.f===id&&label[e.t])to.push(label[e.t]+(e.text?" ("+e.text+")":""))});
var btn=fig.querySelector('.plate button[data-node="'+id+'"]'),sentence=btn?btn.dataset.note:"";
note.textContent="";var b=document.createElement("strong");b.textContent=label[id]+" ";note.appendChild(b);
if(sentence){note.appendChild(document.createTextNode(sentence))}
var c=document.createElement("span");c.className="conn";c.textContent=(from.length?"Takes from "+words(from)+". ":"")+(to.length?"Hands to "+words(to)+".":"");if(c.textContent)note.appendChild(c)}
function pin(id){step=-1;sel=sel===id?null:id;stepno.textContent="All parts";describe(sel);mark();draw()}
function mark(){$$(fig,".plate button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.node===sel||(step>=0&&b.dataset.node===order[step])))})}
function go(k){if(k<0||k>=order.length){return}step=k;sel=null;stepno.textContent="Step "+(k+1)+" of "+order.length;describe(order[k]);mark();draw()}
function clear(){step=-1;sel=null;stepno.textContent="All parts";describe(null);mark();draw()}
function apply(){var x=view[0],y=view[1],w=view[2],h=view[3];svgs.forEach(function(s){s.setAttribute("viewBox",x+" "+y+" "+w+" "+h)});stage.classList.toggle("zoomed",scale>1)}
function zoom(f,cx,cy){var ns=Math.max(1,Math.min(5,scale*f));if(ns===scale)return;var w=base[2]/ns,h=base[3]/ns;
var rx=cx===undefined?.5:cx,ry=cy===undefined?.5:cy;view[0]=view[0]+(view[2]-w)*rx;view[1]=view[1]+(view[3]-h)*ry;view[2]=w;view[3]=h;scale=ns;fit();apply()}
function fit(){view[0]=Math.max(base[0],Math.min(base[0]+base[2]-view[2],view[0]));view[1]=Math.max(base[1],Math.min(base[1]+base[3]-view[3],view[1]))}
function reset(){view=base.slice();scale=1;apply()}
svgs.forEach(function(s){$$(s,"g.node").forEach(function(g){g.setAttribute("tabindex","0");g.setAttribute("role","button");g.setAttribute("aria-label",g.dataset.label+": show connections");
g.addEventListener("mouseenter",function(){hover=g.dataset.node;draw()});g.addEventListener("mouseleave",function(){hover=null;draw()});
g.addEventListener("focus",function(){hover=g.dataset.node;draw()});g.addEventListener("blur",function(){hover=null;draw()});
g.addEventListener("click",function(ev){ev.stopPropagation();pin(g.dataset.node)});
g.addEventListener("keydown",function(ev){if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();pin(g.dataset.node)}})})});
fig.addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest("button");if(!b||!fig.contains(b))return;
if(b.dataset.node){pin(b.dataset.node);return}
var d=b.dataset["do"];if(d==="next")go(step<0?0:step+1);else if(d==="prev")go(step<0?order.length-1:step-1);else if(d==="clear")clear();else if(d==="in")zoom(1.4);else if(d==="out")zoom(1/1.4);else if(d==="reset")reset()});
fig.addEventListener("keydown",function(ev){if(ev.target.closest&&ev.target.closest("button"))return;var k=ev.key;
if(k==="ArrowRight")go(step<0?0:step+1);else if(k==="ArrowLeft")go(step<0?order.length-1:step-1);else if(k==="Escape")clear();else if(k==="+"||k==="=")zoom(1.4);else if(k==="-")zoom(1/1.4);else if(k==="0")reset();else return;ev.preventDefault()});
stage.addEventListener("wheel",function(ev){if(!(ev.ctrlKey||ev.metaKey))return;ev.preventDefault();var r=stage.getBoundingClientRect();zoom(ev.deltaY<0?1.15:1/1.15,(ev.clientX-r.left)/r.width,(ev.clientY-r.top)/r.height)},{passive:false});
var pts={},last=0,drag=null;
stage.addEventListener("pointerdown",function(ev){pts[ev.pointerId]=[ev.clientX,ev.clientY];if(Object.keys(pts).length===2){var a=Object.keys(pts).map(function(i){return pts[i]});last=Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1])}
else if(scale>1&&!(ev.target.closest&&ev.target.closest("g.node"))){drag=[ev.clientX,ev.clientY];stage.classList.add("drag");stage.setPointerCapture(ev.pointerId)}});
stage.addEventListener("pointermove",function(ev){if(!pts[ev.pointerId])return;pts[ev.pointerId]=[ev.clientX,ev.clientY];var ks=Object.keys(pts);
if(ks.length===2){var a=ks.map(function(i){return pts[i]}),d=Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]);if(last)zoom(d/last);last=d;return}
if(drag){var r=stage.getBoundingClientRect();view[0]-=(ev.clientX-drag[0])*view[2]/r.width;view[1]-=(ev.clientY-drag[1])*view[3]/r.height;drag=[ev.clientX,ev.clientY];fit();apply()}});
function up(ev){delete pts[ev.pointerId];last=0;drag=null;stage.classList.remove("drag")}
stage.addEventListener("pointerup",up);stage.addEventListener("pointercancel",up)})})();`;
