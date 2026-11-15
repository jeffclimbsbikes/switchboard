import { ICON_DATA_URI } from "./icon.js";

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>switchboard</title>
<meta name="theme-color" content="#0a2e24">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="switchboard">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="robots" content="noindex,nofollow">
<link rel="apple-touch-icon" href="__ICON__">
<link rel="icon" type="image/png" href="__ICON__">
<style>
:root{color-scheme:dark;--mask:#0a2e24;--mask-2:#0d382c;--mask-3:#124536;--chip:#121614;--copper:#bc8526;--copper-hi:#e2b45c;--cyan:#2a9cc8;--ind:#818cf8;
--silk:#eef0e4;--silk-2:#b9cdbf;--silk-3:#7f9c8c;--line:#2b5a49;--good:#7ee08a;--warn:#ffc24a;--bad:#ff6b5e;
--mono:ui-monospace,"SF Mono","JetBrains Mono","Cascadia Mono",Menlo,Consolas,monospace;
--sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--mask);color:var(--silk);-webkit-text-size-adjust:100%}
body{font:15px/1.4 var(--sans);min-height:100vh;
padding:max(14px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));
background:radial-gradient(circle at 1px 1px,rgba(238,240,228,.05) 1px,transparent 1.4px) 0 0/18px 18px,radial-gradient(1200px 700px at 80% -10%,#10473a 0%,transparent 60%),var(--mask);overflow-x:hidden}
body.locked{overflow:hidden}
a{color:var(--copper-hi);text-underline-offset:3px}
b{font-weight:650}
code,.mono{font-family:var(--mono)}
button{font:inherit;color:inherit}
.traces{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:.5}
.traces path{fill:none;stroke:#1c5a45;stroke-width:2}
.traces circle{fill:var(--mask);stroke:#2f6e57;stroke-width:2}
.traces .pulse{stroke:var(--copper);stroke-dasharray:6 400;animation:flow 6s linear infinite;opacity:.8}
.traces .pulse.b{stroke:var(--ind);animation-duration:9s;animation-delay:-3s}
@keyframes flow{from{stroke-dashoffset:406}to{stroke-dashoffset:0}}
.board-head,.board,.board-foot{position:relative;z-index:1;max-width:1240px;margin:0 auto}
.board-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 16px;align-items:end;padding:6px 4px 14px;border-bottom:2px dashed var(--line);margin-bottom:16px}
.logo{min-width:0}
.silk-small,.refdes,dt,.hero-label,.facts span,.key,.sublab,.summary span,.lab{font-family:var(--mono);text-transform:uppercase;letter-spacing:.09em;font-size:11px;color:var(--silk-3)}
h1{font:800 clamp(30px,9vw,76px)/.9 var(--mono);letter-spacing:-.04em;color:var(--silk);margin-top:6px}
h1 .rev{font-size:clamp(10px,.24em,16px);letter-spacing:.16em;vertical-align:top;margin-left:.7em;padding:2px 5px;border:1.5px solid var(--ind);color:var(--ind);position:relative;top:.5em;white-space:nowrap}
.leds{display:flex;gap:14px;align-self:start;padding-top:4px}
.led-wrap{display:grid;justify-items:center;gap:4px;font:10px var(--mono);color:var(--silk-3);letter-spacing:.1em}
.led{width:12px;height:8px;border-radius:2px;background:#333;display:block}
.led-pwr{background:var(--ind);box-shadow:0 0 10px #818cf8aa}
.led-act{background:#1f4d2a;transition:background .1s,box-shadow .1s}
.led-act.on{background:#57ff6d;box-shadow:0 0 12px #57ff6dcc}
.led-act.dead{background:#ff3b30;box-shadow:0 0 10px #ff3b30aa}
.head-facts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px 22px;min-width:0}
.head-facts div{display:flex;gap:8px;align-items:baseline;min-width:0;max-width:100%}
dd{font:600 15px var(--mono);color:var(--silk);overflow-wrap:anywhere}
.refresh.paused dd,.refresh.paused .dot{color:var(--warn)}
.refresh.offline dd,.refresh.denied dd{color:var(--bad)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--silk-3);margin-right:7px;vertical-align:0}
.refresh.live .dot{background:var(--good);box-shadow:0 0 8px var(--good)}
.refresh.offline .dot,.refresh.denied .dot{background:var(--bad)}
.refresh.paused .dot{background:var(--warn)}
.banner{position:relative;z-index:1;max-width:1240px;margin:0 auto 14px;padding:10px 12px;border-radius:6px;background:rgba(255,107,94,.1);border:1.5px solid var(--bad);color:#ffc7c1;font-size:14px}
.summary{grid-column:1/-1;list-style:none;display:grid;grid-template-columns:repeat(7,1fr);gap:1.5px;border:1.5px solid var(--line);border-radius:6px;overflow:hidden;background:var(--line)}
.summary span{overflow-wrap:anywhere}
.summary li{padding:8px 11px;background:#0b3228;display:grid;gap:1px;align-content:start;min-width:0}
.summary b{font:650 20px/1.2 var(--mono);color:var(--silk);white-space:nowrap;font-variant-numeric:tabular-nums}
.summary b small{font-size:13px;color:var(--silk-3);font-weight:500}
.summary .k-working b{color:var(--ind)}
.summary .k-idle b{color:var(--good)}
.summary .k-failed.on b{color:var(--bad)}
.summary .k-waiting.hot{background:#3a3414;box-shadow:inset 0 0 0 1.5px var(--warn)}
.summary .k-waiting.hot b{color:var(--warn);font-size:26px;line-height:1.1}
.summary .k-waiting.hot span{color:var(--warn)}
@media(max-width:820px){.summary{grid-template-columns:repeat(6,1fr)}
.summary li{grid-column:span 2}
.summary .k-total{grid-column:span 6}
.summary.hot .k-total{grid-column:span 2}
.summary.hot .k-waiting{grid-column:span 6;order:-1}}
.board{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))}
.part{position:relative;background:var(--mask-2);border:1.5px solid var(--line);border-radius:8px;padding:30px 16px 16px;min-width:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 6px 18px rgba(0,0,0,.25)}
.part::before,.part::after{content:"";position:absolute;top:9px;width:9px;height:9px;border-radius:50%;border:2px solid var(--copper);background:var(--mask)}
.part::before{left:9px}.part::after{right:9px}
.part.wide{grid-column:1/-1}
@media(max-width:480px){.part{padding:30px 12px 14px}}
.refdes{position:absolute;top:8px;left:26px;right:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--silk-2)}
.refdes .count{color:var(--silk-3);margin-left:6px}
.hero{font:750 54px/1 var(--mono);letter-spacing:-.03em;color:var(--silk);font-variant-numeric:tabular-nums}
.hero.md{font-size:42px}
.hero small{font-size:18px;font-weight:600;letter-spacing:0;color:var(--silk-2);margin-left:4px}
.hero-label{margin-top:4px}
.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.facts div{display:grid;gap:2px;min-width:0}
.facts b{font:650 16px var(--mono);color:var(--silk);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sublab{display:flex;align-items:center;gap:10px;margin:16px 0 8px;padding-top:12px;border-top:1px dashed var(--line);color:var(--silk-2)}
.sublab .count{color:var(--silk-3)}
.sp{flex:1}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.sub{color:var(--silk-3);font-size:12.5px}
.note{color:var(--silk-3);font-size:12.5px;margin:10px 0 0}
.desc{margin:8px 0 0;color:var(--silk-2);font-size:13.5px}
.badge{display:inline-block;border-radius:3px;padding:0 6px;font:600 10.5px/17px var(--mono);letter-spacing:.07em;text-transform:uppercase;border:1px solid var(--line);color:var(--silk-2);white-space:nowrap}
.drv-claude{color:#f0a37a;border-color:rgba(240,163,122,.45)}
.drv-acp{color:#6cc6d9;border-color:rgba(108,198,217,.45)}
.drv-fake{color:var(--silk-3)}
.b-default{color:var(--copper-hi);border-color:var(--copper)}
.b-ro{color:var(--good);border-color:rgba(126,224,138,.4)}
.b-destr{color:var(--bad);border-color:rgba(255,107,94,.5)}
.b-req{color:var(--warn);border-color:rgba(255,194,74,.45)}
.b-exp{color:var(--warn);border-color:rgba(255,194,74,.4)}
.b-ind{color:var(--ind);border-color:rgba(129,140,248,.5)}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:10px;padding:1px 9px 1px 7px;font:600 10.5px/16px var(--mono);letter-spacing:.08em;border:1px solid currentColor;text-transform:uppercase;white-space:nowrap}
.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.s-waiting{color:var(--warn)}.s-working,.s-starting{color:var(--ind)}.s-idle{color:var(--good)}.s-failed{color:var(--bad)}.s-parked{color:var(--silk-2)}.s-closed{color:var(--silk-3)}
.pill.s-working::before,.pill.s-starting::before{animation:pulse2 1.6s ease-in-out infinite}
@keyframes pulse2{0%,100%{opacity:1}50%{opacity:.35}}
.livedot{width:8px;height:8px;border-radius:50%;background:#3b4a43;flex:none}
.livedot.on{background:var(--good);box-shadow:0 0 8px var(--good)}
.agents{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr))}
.ic{--sp:0px;display:flex;padding:9px 0;min-width:0;background:repeating-linear-gradient(90deg,var(--copper) 0 6px,transparent 6px 14px) top/calc(100% - 32px) 9px no-repeat,repeating-linear-gradient(90deg,var(--copper) 0 6px,transparent 6px 14px) bottom/calc(100% - 32px) 9px no-repeat,repeating-linear-gradient(0deg,var(--copper) 0 6px,transparent 6px 14px) left/var(--sp) calc(100% - 32px) no-repeat,repeating-linear-gradient(0deg,var(--copper) 0 6px,transparent 6px 14px) right/var(--sp) calc(100% - 32px) no-repeat}
@media(min-width:600px){.ic{--sp:9px;padding:9px}}
.ic-body{flex:1;background:linear-gradient(145deg,#1b201d,var(--chip));border-radius:6px;padding:16px 14px 14px;border:1px solid #2a302c;position:relative;min-width:0}
.ic-body::before{content:"";position:absolute;left:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#2a302c}
.ic .refdes2{font:11px var(--mono);text-transform:uppercase;letter-spacing:.09em;color:var(--silk-3);padding-left:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ic-top{display:flex;align-items:flex-start;gap:10px;margin-top:8px;flex-wrap:wrap}
.ic-name{font:800 26px/1.05 var(--mono);letter-spacing:-.02em;overflow-wrap:anywhere;min-width:0;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.ic-live{margin-left:auto;text-align:right}
.ic-live b{font:750 38px/1 var(--mono);display:block;font-variant-numeric:tabular-nums;color:var(--silk)}
.ic-live.on b{color:var(--ind)}
.ic-live span{font:10.5px var(--mono);text-transform:uppercase;letter-spacing:.09em;color:var(--silk-3)}
.ic-spec{font:12px var(--mono);color:var(--silk-2);margin-top:8px;overflow-wrap:anywhere}
.ic-spec i{font-style:normal;color:var(--silk-3)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:12px;padding:2px 10px;font:12px var(--mono);cursor:pointer;color:var(--silk)}
.chip.s-waiting{border-color:var(--warn)}.chip.s-working,.chip.s-starting{border-color:var(--ind)}.chip.s-idle{border-color:var(--good)}
.chip .cs{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:6px}
.chip:focus-visible,.scard:focus-visible,.tabs button:focus-visible,.tbtn:focus-visible,.x:focus-visible{outline:2px solid var(--ind);outline-offset:2px}
.mdls{margin-top:12px}
.mdl{padding:9px 0;border-top:1px dashed #33403a}
.mdl .mh{display:flex;flex-wrap:wrap;gap:3px 10px;align-items:baseline}
.mdl .ml{font-weight:650;font-size:14px}
.mdl .mi{font:11.5px var(--mono);color:var(--silk-3);overflow-wrap:anywhere}
.mdl .mp{font:11.5px var(--mono);color:var(--copper-hi);margin-left:auto;text-align:right}
.mdl .mp.none{color:var(--silk-3)}
.mdl .md{font-size:12.5px;color:var(--silk-2);margin-top:3px}
.mdl .mn{font-size:12px;color:var(--silk-3);margin-top:2px}
.mdl.def{border-top-color:var(--copper)}
.wsrow{display:flex;flex-wrap:wrap;gap:8px}
.wchip{flex:1 1 230px;min-width:0;display:grid;grid-template-columns:14px 1fr;gap:1px 10px;padding:8px 10px 8px 8px;border-radius:5px;background:rgba(0,0,0,.16);border:1px solid #1d4a3b}
.pin{width:14px;height:14px;border-radius:3px;border:2px solid var(--copper);display:grid;place-items:center;grid-row:span 3;margin-top:2px}
.pin::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--good);box-shadow:0 0 8px var(--good)}
.wchip .wn{font:600 14px var(--mono);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.wchip .wp{font:11.5px var(--mono);color:var(--silk-3);overflow-wrap:anywhere}
.wchip .wd{font-size:12.5px;color:var(--silk-2)}
.win{margin-top:16px}
.win:first-of-type{margin-top:14px}
.win .wh{display:flex;align-items:baseline;gap:4px 12px;flex-wrap:wrap}
.win .pctn{font:750 40px/1 var(--mono);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.win .pctn small{font-size:16px;color:var(--silk-2)}
.gs{font:700 11px var(--mono);text-transform:uppercase;letter-spacing:.09em}
.gs.allowed{color:var(--good)}.gs.warning{color:var(--warn)}.gs.rejected{color:var(--bad)}
.segs{display:flex;gap:2px;height:22px;margin-top:8px;border-radius:4px;overflow:hidden;background:var(--mask)}
.segs i{flex:1;background:var(--mask-3);display:block}
.segs i.on{background:var(--copper)}
.segs.warning i.on{background:var(--warn)}
.segs.rejected i.on{background:var(--bad)}
.segs.allowed i.on:last-of-type{border-right:2px solid #ffd98a}
.wmeta{display:flex;justify-content:space-between;gap:10px;margin-top:5px;font:11px var(--mono);color:var(--silk-3);flex-wrap:wrap}
.bars{display:flex;align-items:flex-end;gap:6px;height:116px;margin-top:14px;padding-bottom:0;border-bottom:1px solid var(--line)}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.bar i{display:block;width:100%;background:linear-gradient(0deg,var(--copper),var(--copper-hi));border-top:2px solid #ffd98a;border-radius:2px 2px 0 0;min-height:2px}
.bar i.z{background:var(--mask-3);border-top:0}
.bar b{font:600 11px var(--mono);margin-bottom:3px;color:var(--silk-2)}
.barlab{display:flex;gap:6px;margin-top:4px}
.barlab span{flex:1;text-align:center;font:10px var(--mono);color:var(--silk-3)}
.row-line{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)}
.row-line b{font:600 14px var(--mono);text-align:right}
table.plain{width:100%;border-collapse:collapse;font-size:13px}
table.plain th{text-align:left;font:500 10.5px var(--mono);color:var(--silk-3);text-transform:uppercase;letter-spacing:.08em;padding:0 6px 6px}
table.plain td{padding:7px 6px;border-top:1px solid var(--line);overflow-wrap:anywhere;vertical-align:top;font-family:var(--mono)}
table.plain td b{color:var(--silk)}
.empty{color:var(--silk-3);font-size:13px;padding:14px;border:1px dashed var(--line);border-radius:6px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:8px}
.gh2{display:flex;align-items:center;gap:10px;margin:22px 0 8px;font:600 12px var(--mono);text-transform:uppercase;letter-spacing:.09em}
.gh2:first-child{margin-top:2px}
.gh2 .count{border:1px solid currentColor;border-radius:10px;padding:0 8px;font-size:11px}
.sgroups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:0 14px;align-items:start}
.board-group.g-waiting{grid-column:1/-1}
.sgroups>details{grid-column:1/-1}
.board-group.g-waiting .gh2{color:var(--warn)}
.board-group.g-waiting .gh2::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--warn);box-shadow:0 0 10px var(--warn)}
.scard{background:rgba(0,0,0,.2);border-left:3px solid var(--line);border-radius:4px;padding:10px 12px;min-width:0;cursor:pointer;display:block;width:100%;text-align:left;overflow-wrap:anywhere}
.scard:hover{background:rgba(0,0,0,.3)}
.scard.st-waiting{border-left-color:var(--warn);background:rgba(255,194,74,.06)}
.scard.st-working,.scard.st-starting{border-left-color:var(--ind)}
.scard.st-idle{border-left-color:var(--good)}
.scard.st-failed{border-left-color:var(--bad)}
.scard .name{font:650 15px var(--mono)}
.age{color:var(--silk-3);font:11.5px var(--mono);font-variant-numeric:tabular-nums}
.title{margin:6px 0 2px;font-weight:600}
.act{font:12px var(--mono);color:var(--silk-3);margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
div.pending{margin-top:8px;border:1px solid rgba(255,194,74,.55);background:rgba(255,194,74,.08);border-radius:5px;padding:8px 10px}
.pending-h{color:var(--warn);font:700 10.5px var(--mono);text-transform:uppercase;letter-spacing:.09em}
.pending-q{margin-top:3px;white-space:pre-wrap}
.scard .pending-q{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.opt{border:1px solid rgba(255,194,74,.5);border-radius:10px;padding:0 9px;font:11.5px var(--mono);color:#ffd58a}
.optlist{margin:6px 0 0;padding:0;list-style:none}
.optlist li{padding:5px 0;border-top:1px solid rgba(255,194,74,.2)}
.optlist li small{display:block;color:var(--silk-3)}
details.closed>summary,details.fold>summary{cursor:pointer;color:var(--silk-2);margin:16px 0 8px;font:600 12px var(--mono);text-transform:uppercase;letter-spacing:.09em}
details.fold>summary{margin:12px 0 6px}
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tabs button{font:600 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--silk-2);background:transparent;border:1px solid var(--line);border-radius:12px;padding:6px 13px;cursor:pointer}
.tabs button[aria-selected=true]{background:var(--copper);border-color:var(--copper);color:#1a1203}
.tbtn{font:600 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;background:transparent;border:1px solid var(--line);border-radius:12px;padding:5px 12px;cursor:pointer;color:var(--silk-2)}
.tbtn[aria-pressed=true]{background:var(--ind);border-color:var(--ind);color:#0d1033}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}
.kv dd{font:13px var(--mono);overflow-wrap:anywhere;font-weight:500}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);font-size:12.5px}
pre.box{background:rgba(0,0,0,.28);border:1px solid var(--line);border-radius:6px;padding:12px;max-height:60vh;overflow:auto;color:var(--silk-2)}
.tool{border-top:1px dashed var(--line);padding:14px 0}
.tool-h{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:baseline}
.tool-h .name{font:700 15px var(--mono);color:var(--copper-hi)}
.tool-h .tt{color:var(--silk-3)}
table.schema{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
table.schema th{text-align:left;font:500 10.5px var(--mono);color:var(--silk-3);text-transform:uppercase;letter-spacing:.08em;padding:4px 8px;border-bottom:1px solid var(--line)}
table.schema td{padding:6px 8px;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
table.schema td.p{font:600 13px var(--mono)}
.cons{display:flex;flex-wrap:wrap;gap:4px}
.cons span{font:11.5px var(--mono);background:rgba(0,0,0,.3);border-radius:3px;padding:0 6px}
@media(max-width:719px){
table.schema thead,table.plain.stack thead{display:none}
table.schema,table.schema tbody,table.schema tr,table.schema td,table.plain.stack,table.plain.stack tbody,table.plain.stack tr,table.plain.stack td{display:block;width:100%}
table.schema tr,table.plain.stack tr{padding:8px 0;border-bottom:1px solid var(--line)}
table.schema td,table.plain.stack td{border:0;padding:2px 0}
table.schema td[data-l]::before,table.plain.stack td[data-l]::before{content:attr(data-l) " ";color:var(--silk-3);font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-right:6px}
table.schema td.p::before{content:none}}
a.ext{color:var(--copper-hi)}
.board-foot{margin-top:22px;text-align:center;font:11px var(--mono);color:var(--silk-3);letter-spacing:.05em}
#scrim{position:fixed;inset:0;background:rgba(2,14,10,.65);z-index:20;opacity:0;pointer-events:none;transition:opacity .2s}
#scrim.open{opacity:1;pointer-events:auto}
#drawer{position:fixed;z-index:21;background:var(--mask-2);border:1.5px solid var(--line);display:flex;flex-direction:column;transition:transform .22s ease;left:0;right:0;bottom:0;height:90vh;height:90dvh;border-radius:14px 14px 0 0;transform:translateY(105%);padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -10px 40px rgba(0,0,0,.5)}
#drawer.open{transform:none}
@media(min-width:900px){#drawer{left:auto;top:0;height:100vh;width:min(580px,100vw);border-radius:0;transform:translateX(105%);padding-right:env(safe-area-inset-right)}}
.dh{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:2px dashed var(--line);padding-top:max(14px,env(safe-area-inset-top))}
.dh .name{font:800 20px var(--mono);letter-spacing:-.02em;overflow-wrap:anywhere;min-width:0}
.dh .x{background:transparent;border:1.5px solid var(--copper);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:1.1rem;line-height:1;color:var(--copper-hi);flex:none}
.db{overflow-y:auto;overflow-x:hidden;padding:12px 16px 24px;flex:1;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.dtitle{font-size:17px;font-weight:600;margin:2px 0 12px}
.tl{margin:12px 0 0;padding:0 0 0 14px;border-left:2px solid var(--line);list-style:none}
.ev{position:relative;margin:0 0 10px;padding:0 0 0 4px;min-width:0}
.ev::before{content:"";position:absolute;left:-20px;top:7px;width:8px;height:8px;border-radius:50%;background:var(--line)}
.ev .eh{display:flex;gap:8px;align-items:baseline;font:11px var(--mono);color:var(--silk-3)}
.ev .eh .k{color:var(--silk-2);text-transform:uppercase;letter-spacing:.08em}
.ev .eb{margin-top:2px;white-space:pre-wrap;overflow-wrap:anywhere}
.ev.e-prompt::before{background:var(--ind)}
.ev.e-prompt .eb{background:rgba(129,140,248,.12);border:1px solid rgba(129,140,248,.4);border-radius:6px;padding:8px 10px}
.ev.e-text::before{background:var(--silk-2)}
.ev.e-tool .eb{font:12.5px var(--mono)}
.ev.e-tool.t-done::before{background:var(--good)}.ev.e-tool.t-failed::before{background:var(--bad)}.ev.e-tool.t-running::before{background:var(--ind)}
.ev.e-request::before{background:var(--warn)}
.ev.e-error::before{background:var(--bad)}.ev.e-error .eb{color:#ffc7c1}
.ev.e-turn_end::before{background:var(--copper)}
.ev.e-note .eb,.ev.e-session .eb{color:var(--silk-3);font-style:italic}
.more{background:none;border:0;color:var(--copper-hi);cursor:pointer;padding:2px 0;font:12px var(--mono)}
.plan{margin:2px 0 0;padding:0;list-style:none;font-size:13.5px}
.plan li::before{content:"○ ";color:var(--silk-3)}.plan li.completed::before{content:"● ";color:var(--good)}.plan li.in_progress::before{content:"◐ ";color:var(--ind)}
@media(max-width:480px){h1 .rev{display:block;width:fit-content;margin:8px 0 0;top:0}.hero{font-size:46px}.ic-name{font-size:23px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<svg class="traces" aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
<path d="M-20 150H230L270 190H560L600 150H940L980 110H1460"/><circle cx="230" cy="150" r="5"/><circle cx="940" cy="150" r="5"/>
<path d="M-20 420H120L170 470H430L470 430H700L740 470H1100L1140 430H1460"/><circle cx="430" cy="470" r="5"/><circle cx="1100" cy="470" r="5"/>
<path d="M-20 700H300L340 660H780L820 700H1200L1240 740H1460"/><circle cx="300" cy="700" r="5"/><circle cx="1200" cy="700" r="5"/>
<path d="M360 -20V120L400 160V520L360 560V920"/><circle cx="400" cy="340" r="5"/>
<path d="M1020 -20V240L1060 280V620L1020 660V920"/><circle cx="1060" cy="450" r="5"/>
<path class="pulse" d="M-20 150H230L270 190H560L600 150H940L980 110H1460"/>
<path class="pulse b" d="M-20 700H300L340 660H780L820 700H1200L1240 740H1460"/>
</svg>
<header class="board-head">
<div class="logo">
<div class="silk-small">MCP control plane · agent sessions</div>
<h1>SWITCHBOARD<span class="rev" id="ver">v</span></h1>
</div>
<div class="leds">
<div class="led-wrap"><i class="led led-pwr"></i><span>PWR</span></div>
<div class="led-wrap"><i class="led led-act" id="led"></i><span>ACT</span></div>
</div>
<dl class="head-facts">
<div><dt>uptime</dt><dd id="uptime">–</dd></div>
<div><dt>auth</dt><dd id="auth">–</dd></div>
<div class="refresh" id="refresh"><dt>feed</dt><dd><i class="dot"></i><span id="refreshText">connecting</span></dd></div>
</dl>
<ul class="summary" id="kpis" aria-label="Summary"></ul>
</header>
<div id="banner" class="banner" hidden></div>
<main class="board" id="main"><div class="empty" style="grid-column:1/-1">Loading…</div></main>
<section class="board" style="margin-top:16px">
<div class="part wide">
<div class="refdes">J4 · tools &amp; connections</div>
<nav class="tabs" id="tabs" role="tablist" aria-label="Sections"></nav>
<div id="tabbody"></div>
</div>
</section>
<footer class="board-foot">switchboard · polling every 3 s · paused while hidden</footer>
<div id="scrim"></div>
<aside id="drawer" role="dialog" aria-modal="true" aria-label="Session detail">
<div class="dh" id="dhead"></div>
<div class="db" id="dbody">
<div id="dmeta"></div>
<div id="dpending"></div>
<div class="sublab">Timeline</div>
<div class="note" id="dnote"></div>
<ol class="tl" id="timeline"></ol>
</div>
</aside>
<script>
(function () {
  "use strict";
  var POLL_MS = 3000;
  var CLOSED_NOTE = "Showing the 100 most recent closed sessions.";
  var GROUPS = [
    { id: "waiting", label: "Waiting on you", states: ["waiting"] },
    { id: "working", label: "Working", states: ["working", "starting"] },
    { id: "idle", label: "Idle", states: ["idle"] },
    { id: "parked", label: "Parked", states: ["parked"] },
    { id: "failed", label: "Failed", states: ["failed"] },
    { id: "closed", label: "Closed", states: ["closed"] }
  ];
  var TABS = [["tools", "Tools"], ["connections", "Connections"]];

  var state = null;
  var mcp = null;
  var mcpError = null;
  var skew = 0;
  var tab = "tools";
  var rawTools = false;
  var closedOpen = false;
  var costOpen = false;
  var lastKey = "";
  var timer = null;
  var busy = false;
  var drawer = { name: null, lastSeq: 0, seen: {}, tools: {}, loaded: false, truncated: false, missing: false };

  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function nowMs() { return Date.now() + skew; }
  function dur(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    var hh = Math.floor(m / 60);
    if (hh < 48) return hh + "h" + (m % 60 ? " " + (m % 60) + "m" : "");
    return Math.floor(hh / 24) + "d " + (hh % 24) + "h";
  }
  function ago(iso) { return dur(nowMs() - Date.parse(iso)) + " ago"; }
  function until(iso) {
    var d = Date.parse(iso) - nowMs();
    return d <= 0 ? "expired" : "in " + dur(d);
  }
  function clock(iso) { return new Date(iso).toLocaleTimeString([], { hour12: false }); }
  function fullTime(iso) { return new Date(iso).toLocaleString(); }
  function hostOf(id) {
    try { return new URL(id).host; } catch (e) { return id; }
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  function driverOf(agentId) {
    var a = state && state.agents.filter(function (x) { return x.id === agentId; })[0];
    return a ? a.driver : "";
  }
  function agentBadge(id) {
    var d = driverOf(id);
    return h("span", { class: "badge drv-" + d, title: d ? "driver: " + d : "" }, id);
  }
  function pill(st) { return h("span", { class: "pill s-" + st }, st); }

  function pendingBlock(p, compact) {
    var box = h("div", { class: "pending" });
    if (p.kind === "approval") {
      box.appendChild(h("div", { class: "pending-h" }, "Approval needed · ", h("code", null, p.tool)));
      box.appendChild(h("div", { class: "pending-q", text: p.summary }));
      var labels = p.options.map(function (o) { return o.label; });
      if (compact) {
        box.appendChild(h("div", { class: "opts" }, labels.slice(0, 4).map(function (l) { return h("span", { class: "opt" }, l); })));
      } else {
        box.appendChild(h("ul", { class: "optlist" }, p.options.map(function (o) {
          return h("li", null, o.label, h("small", null, o.kind + " · id " + o.id));
        })));
        if (p.input !== undefined) {
          box.appendChild(h("details", { class: "fold" }, h("summary", null, "tool input"), h("pre", { class: "box", text: JSON.stringify(p.input, null, 2) })));
        }
      }
      return box;
    }
    var qs = compact ? p.questions.slice(0, 1) : p.questions;
    box.appendChild(h("div", { class: "pending-h" }, "Question" + (p.questions.length > 1 ? "s" : "") + " for you"));
    qs.forEach(function (q) {
      box.appendChild(h("div", { class: "pending-q" }, q.header ? h("b", null, q.header + " — ") : null, q.question));
      if (compact) {
        var shown = q.options.slice(0, 4);
        box.appendChild(h("div", { class: "opts" }, shown.map(function (o) { return h("span", { class: "opt" }, o.label); }),
          q.options.length > shown.length ? h("span", { class: "opt" }, "+" + (q.options.length - shown.length)) : null));
      } else {
        if (q.multiSelect) box.appendChild(h("div", { class: "sub" }, "more than one allowed"));
        box.appendChild(h("ul", { class: "optlist" }, q.options.map(function (o, i) {
          return h("li", null, (i + 1) + ". " + o.label, o.description ? h("small", null, o.description) : null);
        })));
      }
    });
    return box;
  }

  function sessionByName(name) {
    return state && state.sessions.filter(function (s) { return s.name === name; })[0];
  }

  function part(ref, cls, children) {
    var el = h("section", { class: "part " + (cls || "") }, h("div", { class: "refdes" }, ref));
    add(el, children);
    return el;
  }
  function sublab(text, count) {
    return h("div", { class: "sublab" }, text, count !== undefined ? h("span", { class: "count" }, count) : null);
  }
  function openSession(n) { location.hash = "#session/" + encodeURIComponent(n); }

  function sessionCard(s) {
    var last = s.activity.length ? s.activity[s.activity.length - 1] : s.lastActivity;
    return h("div", {
      class: "scard st-" + s.state, role: "button", tabindex: "0",
      "aria-label": "Open session " + s.name,
      onclick: function () { openSession(s.name); },
      onkeydown: function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSession(s.name); }
      }
    },
      h("div", { class: "row" },
        h("span", { class: "livedot" + (s.live ? " on" : ""), title: s.live ? "process running" : "no process" }),
        h("span", { class: "name" }, s.name),
        agentBadge(s.agent),
        pill(s.state),
        h("span", { class: "sp" }),
        h("span", { class: "age", title: "updated " + fullTime(s.updatedAt) }, dur(nowMs() - Date.parse(s.updatedAt)))),
      h("div", { class: "title" }, s.title),
      h("div", { class: "sub mono" }, s.workspace + (s.model ? " · " + s.model : "") + (s.owner ? " · " + s.owner : "")),
      last ? h("div", { class: "act" }, last) : null,
      s.pending ? pendingBlock(s.pending, true) : null);
  }

  function renderHeader() {
    $("ver").textContent = "v" + state.version;
    $("uptime").textContent = dur(state.uptimeSeconds * 1000);
    $("auth").textContent = state.config.auth.login + (state.viewer.email ? " · " + state.viewer.email : "");
  }

  function kpi(cls, n, label, extra) {
    return h("li", { class: cls }, h("span", null, label), h("b", null, n, extra || null));
  }

  function renderKpis() {
    var c = state.counts, b = c.byState;
    var waiting = b.waiting;
    var kp = $("kpis");
    kp.className = "summary" + (waiting > 0 ? " hot" : "");
    clear(kp);
    add(kp, [
      kpi("k-live", c.live, "live agents", h("small", null, " / " + c.maxLive)),
      kpi("k-working", b.working + b.starting, "working"),
      kpi("k-waiting" + (waiting > 0 ? " hot" : ""), waiting, "waiting on you"),
      kpi("k-idle", b.idle, "idle"),
      kpi("k-parked", b.parked, "parked"),
      kpi("k-failed" + (b.failed > 0 ? " on" : ""), b.failed, "failed"),
      kpi("k-total", c.total, "total sessions")
    ]);
    document.title = (waiting > 0 ? "(" + waiting + ") " : "") + "switchboard";
  }

  function priceText(m) {
    if (m.inputPrice === undefined && m.outputPrice === undefined) return "price not published";
    var f = function (n) { return n === undefined ? "?" : "$" + Number(n.toFixed(4)); };
    return f(m.inputPrice) + " in / " + f(m.outputPrice) + " out per M tokens";
  }

  function modelRow(m) {
    var none = m.inputPrice === undefined && m.outputPrice === undefined;
    return h("div", { class: "mdl" + (m.default ? " def" : "") },
      h("div", { class: "mh" },
        m.label ? h("span", { class: "ml" }, m.label) : null,
        h("code", { class: "mi" }, m.id),
        m.default ? h("span", { class: "badge b-default" }, "★ default") : null,
        h("span", { class: "mp" + (none ? " none" : "") }, priceText(m))),
      m.description ? h("div", { class: "md" }, m.description) : null,
      m.notes ? h("div", { class: "mn" }, m.notes) : null);
  }

  function agentChip(a, i) {
    var models = state.catalog[a.id] || [];
    var chips = a.liveSessions.map(function (n) {
      var s = sessionByName(n);
      return h("button", {
        class: "chip s-" + (s ? s.state : "idle"), type: "button",
        onclick: function () { openSession(n); }
      }, h("span", { class: "cs" }), n);
    });
    return h("article", { class: "ic" },
      h("div", { class: "ic-body" },
        h("div", { class: "refdes2" }, "U" + (i + 1) + " · " + a.driver + " · " + a.id),
        h("div", { class: "ic-top" },
          h("div", { class: "ic-name" }, a.id, a.default ? h("span", { class: "badge b-default" }, "default") : null),
          h("div", { class: "ic-live" + (a.live > 0 ? " on" : "") }, h("b", null, a.live), h("span", null, a.live === 1 ? "live session" : "live sessions"))),
        h("div", { class: "ic-spec" }, h("i", null, "driver "), a.driver, h("i", null, " · "), a.model || "model: agent default",
          a.runAs ? [h("i", null, " · run_as "), a.runAs] : null),
        a.description ? h("p", { class: "desc" }, a.description) : null,
        chips.length ? h("div", { class: "chips" }, chips) : null,
        models.length ? h("div", { class: "mdls" }, h("div", { class: "lab", style: "margin-bottom:4px" }, "models · " + models.length), models.map(modelRow)) : null));
  }

  function renderAgents(root) {
    var kids = [h("div", { class: "agents" }, state.agents.map(agentChip))];
    if (!Object.keys(state.catalog).length) {
      kids.push(h("p", { class: "note" }, "No model catalogs configured. Add [[agents.<id>.models]] entries to choose models per agent."));
    } else {
      kids.push(h("p", { class: "note" }, "Prices are list prices per million tokens, for comparison only."));
    }
    kids.push(sublab("Workspaces", state.workspaces.length));
    kids.push(h("div", { class: "wsrow" }, state.workspaces.map(function (w) {
      return h("div", { class: "wchip" }, h("i", { class: "pin" }),
        h("div", { class: "wn" }, w.id, w.default ? h("span", { class: "badge b-default" }, "default") : null),
        h("div", { class: "wp" }, w.path),
        w.description ? h("div", { class: "wd" }, w.description) : null);
    })));
    root.appendChild(part("J1 · available agents", "wide", kids));
    root.lastChild.firstChild.appendChild(h("span", { class: "count" }, state.agents.length + " ready"));
  }

  function renderSessions(root) {
    var sessions = state.sessions.slice().sort(function (a, b) { return Date.parse(b.updatedAt) - Date.parse(a.updatedAt); });
    var total = state.counts.byState;
    var kids = [];
    GROUPS.forEach(function (g) {
      var list = sessions.filter(function (s) { return g.states.indexOf(s.state) >= 0; });
      if (!list.length) return;
      var count = g.states.reduce(function (n, st) { return n + total[st]; }, 0);
      var grid = h("div", { class: "grid" }, list.map(sessionCard));
      if (g.id === "closed") {
        var det = h("details", { class: "closed", ontoggle: function (e) { closedOpen = e.target.open; } },
          h("summary", null, "Closed (" + count + ")"), grid);
        if (closedOpen) det.open = true;
        if (count > list.length) det.appendChild(h("p", { class: "note" }, CLOSED_NOTE));
        kids.push(det);
      } else {
        kids.push(h("div", { class: "board-group g-" + g.id },
          h("div", { class: "gh2 s-" + g.states[0] }, g.label, h("span", { class: "count" }, count)), grid));
      }
    });
    if (!kids.length) kids.push(h("div", { class: "empty" }, "No sessions yet. They appear here when a client calls start."));
    var p = part("J3 · session board", "wide", kids.length && !kids[0].classList.contains("empty") ? h("div", { class: "sgroups" }, kids) : kids);
    p.firstChild.appendChild(h("span", { class: "count" }, plural(state.counts.total, "session")));
    root.appendChild(p);
  }

  function typeOf(s) {
    if (!s || typeof s !== "object") return "any";
    if (s.enum) return "enum";
    if (s.const !== undefined) return "const";
    if (Array.isArray(s.type)) return s.type.join(" | ");
    if (s.type === "array") return "array<" + typeOf(s.items) + ">";
    var alt = s.anyOf || s.oneOf;
    if (alt) return alt.map(typeOf).join(" | ");
    return s.type || "any";
  }
  function constraintsOf(s) {
    var c = [];
    if (!s || typeof s !== "object") return c;
    if (s.enum) s.enum.forEach(function (v) { c.push(String(v)); });
    if (s.const !== undefined) c.push("= " + JSON.stringify(s.const));
    if (s.minimum !== undefined) c.push("min " + s.minimum);
    if (s.exclusiveMinimum !== undefined) c.push("> " + s.exclusiveMinimum);
    if (s.maximum !== undefined) c.push("max " + s.maximum);
    if (s.exclusiveMaximum !== undefined) c.push("< " + s.exclusiveMaximum);
    if (s.minLength !== undefined) c.push("minLength " + s.minLength);
    if (s.maxLength !== undefined) c.push("maxLength " + s.maxLength);
    if (s.minItems !== undefined) c.push("minItems " + s.minItems);
    if (s.maxItems !== undefined) c.push("maxItems " + s.maxItems);
    if (s.pattern) c.push("pattern " + s.pattern);
    if (s.format) c.push("format " + s.format);
    if (s.default !== undefined) c.push("default " + JSON.stringify(s.default));
    return c;
  }

  function schemaTable(schema) {
    var props = schema && schema.properties ? Object.keys(schema.properties) : [];
    if (!props.length) return h("p", { class: "sub" }, "No parameters.");
    var required = (schema && schema.required) || [];
    var body = h("tbody");
    props.forEach(function (name) {
      var p = schema.properties[name];
      var req = required.indexOf(name) >= 0;
      body.appendChild(h("tr", null,
        h("td", { class: "p" }, name),
        h("td", { "data-l": "type", class: "mono" }, typeOf(p)),
        h("td", { "data-l": "required" }, h("span", { class: "badge " + (req ? "b-req" : "") }, req ? "required" : "optional")),
        h("td", { "data-l": "constraints" }, h("div", { class: "cons" }, constraintsOf(p).map(function (x) { return h("span", null, x); }))),
        h("td", { "data-l": "about" }, p.description || "")));
    });
    return h("table", { class: "schema" },
      h("thead", null, h("tr", null, ["Param", "Type", "Required", "Constraints", "Description"].map(function (x) { return h("th", null, x); }))), body);
  }

  function money(n) {
    if (!n) return "$0";
    return "$" + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3));
  }
  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }
  function pct(u) { return Math.round(u * 100) + "%"; }
  function tokenLine(t) {
    return t.input || t.output ? compact(t.input) + " in / " + compact(t.output) + " out" : "";
  }
  function totalsCell(label, t) {
    var tokens = tokenLine(t);
    return h("td", { "data-l": label },
      t.costUsd > 0 ? h("b", null, money(t.costUsd)) : (t.turns > 0 || tokens ? "—" : "·"),
      tokens ? h("div", { class: "sub mono" }, tokens) : null);
  }

  function segGauge(u, status, label) {
    var n = 24, on = u === undefined ? 0 : Math.max(u > 0 ? 1 : 0, Math.round(Math.min(1, u) * n));
    var cells = [];
    for (var i = 0; i < n; i++) cells.push(h("i", { class: i < on ? "on" : "" }));
    return h("div", { class: "segs " + status, role: "img", "aria-label": label + " " + (u === undefined ? "unknown" : pct(u)) }, cells);
  }

  function gauge(w) {
    var u = w.utilization;
    return h("div", { class: "win" },
      h("div", { class: "lab" }, w.label),
      h("div", { class: "wh" },
        h("span", { class: "pctn" }, u === undefined ? "—" : String(Math.round(u * 100)), u === undefined ? null : h("small", null, "%")),
        h("span", { class: "gs " + w.status }, w.status),
        h("span", { class: "sp" }),
        w.resetsAt ? h("span", { class: "sub mono", title: fullTime(w.resetsAt) }, "resets " + until(w.resetsAt)) : null),
      segGauge(u, w.status, w.label));
  }

  function renderClaudePlan(root, c) {
    var exp = c.source === "probe" || c.probe;
    var kids = [h("div", { class: "row" },
      c.subscriptionType ? h("span", { class: "badge drv-claude" }, c.subscriptionType) : h("span", { class: "sub" }, "plan type unknown"),
      exp ? h("span", { class: "badge b-exp", title: "uses an experimental SDK call" }, "experimental") : null)];
    if (c.windows.length) c.windows.forEach(function (w) { kids.push(gauge(w)); });
    else {
      kids.push(h("p", { class: "desc" }, c.unavailable
        ? "Plan limits do not apply to this account (API key or third-party provider)."
        : "No plan data yet. It appears once a Claude session reports its limits" +
          (c.probe ? ", or when the experimental probe next runs." : "; set [usage.claude] probe = true to fetch it on demand (experimental).")));
    }
    if (c.lastSeenAt) {
      kids.push(h("div", { class: "row-line" }, h("span", { class: "lab" }, "source"),
        h("b", { title: fullTime(c.lastSeenAt) }, (c.source === "probe" ? "probe (experimental)" : "live session") + " · " + ago(c.lastSeenAt))));
    }
    root.appendChild(part("U2 · claude · plan windows", "", kids));
  }

  function renderCost(root, u) {
    var sum = function (k) { return u.agents.reduce(function (n, a) { return n + a[k].costUsd; }, 0); };
    var hasClaude = u.agents.some(function (a) { return a.driver === "claude"; });
    var head = function (cols) { return h("thead", null, h("tr", null, cols.map(function (x) { return h("th", null, x); }))); };
    var body = h("tbody");
    u.agents.forEach(function (a) {
      body.appendChild(h("tr", null,
        h("td", { "data-l": "agent" }, agentBadge(a.agent)),
        totalsCell("today", a.today), totalsCell("7 days", a.week), totalsCell("all time", a.total)));
    });
    var kids = [
      h("div", { class: "hero" }, money(sum("today"))),
      h("div", { class: "hero-label" }, "today · all agents"),
      h("div", { class: "facts", style: "grid-template-columns:1fr 1fr" },
        h("div", null, h("b", null, money(sum("week"))), h("span", null, "7 days")),
        h("div", null, h("b", null, money(sum("total"))), h("span", null, "all time"))),
      hasClaude ? h("p", { class: "note" }, "API-equivalent cost (subscription usage, not a bill). Other agents show the cost they report, if any.") : null,
      h("div", { style: "margin-top:12px" }, h("table", { class: "plain stack" }, head(["Agent", "Today", "7 days", "All time"]), body))
    ];
    root.appendChild(part("U3 · cost · api-equivalent", "", kids));
    if (!u.sessions.length) return;
    var sb = h("tbody");
    u.sessions.forEach(function (s) {
      sb.appendChild(h("tr", null,
        h("td", { "data-l": "session" },
          h("a", { class: "ext", href: "#session/" + encodeURIComponent(s.name) }, s.name),
          h("div", { class: "sub" }, s.title)),
        h("td", { "data-l": "agent" }, agentBadge(s.agent)),
        totalsCell("today", s.today), totalsCell("7 days", s.week), totalsCell("all time", s.total)));
    });
    var det = h("details", { class: "fold", ontoggle: function (e) { costOpen = e.target.open; } },
      h("summary", null, "Cost by session (" + u.sessions.length + ")"),
      h("table", { class: "plain stack" }, head(["Session", "Agent", "Today", "7 days", "All time"]), sb));
    if (costOpen) det.open = true;
    root.lastChild.appendChild(det);
  }

  function renderOllama(root, o) {
    var kids = [
      h("div", { class: "row" },
        o.plan ? h("span", { class: "badge drv-acp" }, o.plan) : h("span", { class: "sub" }, "plan unknown"),
        h("span", { class: "badge b-exp", title: "ollama.com/api/me and /api/usage are undocumented and may change" }, "undocumented API")),
      o.totalRequests !== undefined
        ? [h("div", { class: "hero", style: "margin-top:12px" }, String(o.totalRequests), h("small", null, "req")), h("div", { class: "hero-label" }, "requests · last 7 days (UTC)")]
        : null];
    if (o.days.length) {
      var max = Math.max.apply(null, o.days.map(function (d) { return d.requests; }).concat([1]));
      kids.push(h("div", { class: "bars" }, o.days.map(function (d) {
        return h("div", { class: "bar", title: d.date + " (UTC): " + d.requests + " requests" },
          h("b", null, d.requests), h("i", { class: d.requests ? "" : "z", style: "height:" + Math.max(2, Math.round(d.requests / max * 74)) + "px" }));
      })));
      kids.push(h("div", { class: "barlab" }, o.days.map(function (d) { return h("span", null, d.date.slice(5)); })));
    }
    kids.push(h("div", { class: "row-line" }, h("span", { class: "lab" }, "status"),
      o.fetchedAt ? h("b", { title: fullTime(o.fetchedAt) }, "fetched " + ago(o.fetchedAt)) : h("b", null, "not fetched yet")));
    if (o.error) kids.push(h("p", { class: "note" }, "Could not refresh: " + o.error));
    kids.push(h("p", { class: "note" }, "Quota percentage is not available via the API. ",
      h("a", { class: "ext", href: "https://ollama.com/settings", target: "_blank", rel: "noopener noreferrer" }, "Open ollama.com/settings")));
    root.appendChild(part("U4 · ollama · requests", "", kids));
  }

  function renderUsage(root) {
    var u = state.usage;
    if (u.claude) renderClaudePlan(root, u.claude);
    renderCost(root, u);
    if (u.ollama) renderOllama(root, u.ollama);
  }

  function renderTools(root) {
    if (!mcp) {
      root.appendChild(h("div", { class: "empty", style: "margin-top:12px" }, mcpError ? "Could not read the tool contract: " + mcpError : "Loading the tool contract…"));
      return;
    }
    root.appendChild(h("div", { class: "row", style: "margin-top:14px" },
      h("span", { class: "sub" }, plural(mcp.tools.length, "tool") + " exactly as an MCP client lists them"),
      h("span", { class: "sp" }),
      h("button", {
        class: "tbtn", type: "button", "aria-pressed": rawTools ? "true" : "false",
        onclick: function () { rawTools = !rawTools; lastKey = ""; render(); }
      }, "Raw JSON")));
    root.appendChild(sublab("Server instructions", mcp.instructions.length + " chars"));
    root.appendChild(h("pre", { class: "box", text: mcp.instructions }));
    root.appendChild(sublab("Tools", mcp.tools.length));
    mcp.tools.forEach(function (t) {
      var a = t.annotations || {};
      var head = h("div", { class: "tool-h" },
        h("span", { class: "name" }, t.name),
        t.title ? h("span", { class: "tt" }, t.title) : null,
        a.readOnlyHint ? h("span", { class: "badge b-ro" }, "read-only") : null,
        a.destructiveHint ? h("span", { class: "badge b-destr" }, "destructive") : null,
        a.idempotentHint ? h("span", { class: "badge" }, "idempotent") : null,
        a.openWorldHint ? h("span", { class: "badge" }, "open-world") : null);
      var body = rawTools
        ? h("pre", { class: "box", style: "margin-top:10px", text: JSON.stringify(t, null, 2) })
        : h("div", null, t.description ? h("p", { class: "desc", style: "color:var(--silk)" }, t.description) : null,
          h("div", { class: "lab", style: "margin-top:12px" }, "Input"), schemaTable(t.inputSchema));
      root.appendChild(h("div", { class: "tool" }, head, body));
    });
  }

  function renderConnections(root) {
    root.appendChild(sublab("Connected clients", state.grants.length));
    if (!state.grants.length) {
      var why = state.viewer.restricted ? "Not shown for restricted users."
        : state.config.auth.login === "none" ? "Auth is off, so there are no OAuth clients." : "No active grants.";
      root.appendChild(h("div", { class: "empty" }, why));
    } else {
      var body = h("tbody");
      state.grants.forEach(function (g) {
        body.appendChild(h("tr", null,
          h("td", { "data-l": "client" }, h("b", null, g.clientName || hostOf(g.clientId)), h("div", { class: "sub mono" }, hostOf(g.clientId))),
          h("td", { "data-l": "user" }, g.email),
          h("td", { "data-l": "connected", title: fullTime(g.createdAt) }, ago(g.createdAt)),
          h("td", { "data-l": "expires", title: fullTime(g.expiresAt) }, until(g.expiresAt))));
      });
      root.appendChild(h("table", { class: "plain stack" },
        h("thead", null, h("tr", null, ["Client", "Signed in as", "Connected", "Expires"].map(function (x) { return h("th", null, x); }))), body));
    }
    var c = state.config;
    root.appendChild(sublab("Configuration"));
    var rows = [
      ["listen", c.listen],
      ["public_url", c.publicUrl || "—"],
      ["max_wait", dur(c.maxWaitMs)],
      ["idle_park_after", dur(c.idleParkAfterMs)],
      ["max_live_sessions", String(c.maxLiveSessions)],
      ["auth", c.auth.login + (c.auth.team ? " · team " + c.auth.team : "") + (c.auth.allowed ? " · " + plural(c.auth.allowed, "allowed email") : "") + (c.auth.email ? " · " + c.auth.email : "")],
      ["notify", (c.notify.channels.length ? c.notify.channels.join(", ") : "none") + " · nag after " + dur(c.notify.nagAfterMs)]
    ];
    var kv = h("dl", { class: "kv" });
    rows.forEach(function (r) { kv.appendChild(h("dt", null, r[0])); kv.appendChild(h("dd", null, r[1])); });
    root.appendChild(kv);
  }

  function renderTabs() {
    var nav = clear($("tabs"));
    TABS.forEach(function (t) {
      nav.appendChild(h("button", {
        type: "button", role: "tab", "aria-selected": tab === t[0] ? "true" : "false",
        onclick: function () { tab = t[0]; lastKey = ""; render(); }
      }, t[1]));
    });
  }

  function render() {
    if (!state) return;
    var key = JSON.stringify([state.sessions, state.agents, state.workspaces, state.counts, state.grants, state.config, state.version, state.usage, state.catalog, tab, rawTools, !!mcp, mcpError]) + Math.floor(nowMs() / 30000);
    renderHeader();
    if (key === lastKey) return;
    lastKey = key;
    renderTabs();
    renderKpis();
    var main = clear($("main"));
    renderAgents(main);
    renderUsage(main);
    renderSessions(main);
    var tb = clear($("tabbody"));
    if (tab === "tools") renderTools(tb);
    else renderConnections(tb);
  }

  function tl(el, name) { return el.querySelector(name); }

  function setStatus(kind, detail) {
    var r = $("refresh");
    r.className = "refresh " + kind;
    $("led").className = "led led-act" + (kind === "live" ? " on" : kind === "paused" ? "" : " dead");
    $("refreshText").textContent = kind === "live" ? "live · 3s" : kind === "paused" ? "paused" : kind === "denied" ? "access denied" : "offline";
    var b = $("banner");
    if (kind === "denied") { b.hidden = false; b.textContent = "Access denied. Open this page through Cloudflare Access and reload."; }
    else if (kind === "offline") { b.hidden = false; b.textContent = "Cannot reach switchboard" + (detail ? " (" + detail + ")" : "") + ". Retrying every 3 s."; }
    else b.hidden = true;
  }

  function getJson(url) {
    return fetch(url, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } }).then(function (res) {
      if (!res.ok) {
        var e = new Error("HTTP " + res.status);
        e.status = res.status;
        throw e;
      }
      return res.json();
    });
  }

  function fetchState() {
    return getJson("/dashboard/api/state" + (mcp ? "?tools=0" : "")).then(function (s) {
      skew = Date.parse(s.now) - Date.now();
      if (s.mcp) { mcp = s.mcp; mcpError = null; }
      else if (s.mcpError) mcpError = s.mcpError;
      state = s;
      render();
      if (drawer.name) updateDrawerHead();
    });
  }

  function evRow(e) {
    var ev = e.event;
    var kind = ev.type;
    if (kind === "tool" && drawer.tools[ev.id]) {
      var row = drawer.tools[ev.id];
      row.className = "ev e-tool t-" + ev.status;
      tl(row, ".st").textContent = ev.status;
      tl(row, ".tm").textContent = clock(e.at);
      return null;
    }
    var head = h("div", { class: "eh" }, h("span", { class: "k" }, kind === "turn_end" ? "turn end" : kind),
      h("span", { class: "tm", title: fullTime(e.at) }, clock(e.at)), h("span", null, "#" + e.seq),
      kind === "tool" ? h("span", { class: "st" }, ev.status) : null);
    var body;
    switch (kind) {
      case "prompt": body = textBody(ev.text); break;
      case "text": body = textBody(ev.text); break;
      case "tool": body = h("div", { class: "eb" }, ev.title); break;
      case "plan":
        body = h("ul", { class: "plan eb" }, ev.entries.map(function (p) { return h("li", { class: p.status }, p.content); }));
        break;
      case "request": body = h("div", { class: "eb" }, pendingBlock(ev.request, false)); break;
      case "turn_end":
        body = h("div", { class: "eb" }, ev.stopReason +
          (ev.costUsd !== undefined ? " · " + money(ev.costUsd) : "") +
          (ev.tokens ? " · " + tokenLine(ev.tokens) : ""));
        break;
      case "error": body = h("div", { class: "eb" }, (ev.fatal ? "fatal: " : "") + ev.message); break;
      case "session": body = h("div", { class: "eb mono" }, "agent session " + ev.agentSessionId); break;
      default: body = h("div", { class: "eb" }, ev.text || JSON.stringify(ev));
    }
    var li = h("li", { class: "ev e-" + kind + (kind === "tool" ? " t-" + ev.status : "") }, head, body);
    if (kind === "tool") drawer.tools[ev.id] = li;
    return li;
  }

  function textBody(text) {
    var LIMIT = 700;
    var body = h("div", { class: "eb" });
    if (text.length <= LIMIT) { body.textContent = text; return body; }
    var short = true;
    body.textContent = text.slice(0, LIMIT) + "…";
    var btn = h("button", { class: "more", type: "button" }, "Show more (" + text.length + " chars)");
    var wrap = h("div", null, body, btn);
    btn.addEventListener("click", function () {
      short = !short;
      body.textContent = short ? text.slice(0, LIMIT) + "…" : text;
      btn.textContent = short ? "Show more (" + text.length + " chars)" : "Show less";
    });
    var holder = h("div", { class: "eb", style: "white-space:normal" }, wrap);
    return holder;
  }

  function updateDrawerHead() {
    var s = sessionByName(drawer.name);
    if (!s || !drawer.detail) return;
    drawerMeta(drawer.detail);
  }

  function drawerMeta(s) {
    var head = clear($("dhead"));
    head.appendChild(h("span", { class: "livedot" + (s.live ? " on" : ""), title: s.live ? "process running" : "no process" }));
    head.appendChild(h("span", { class: "name" }, s.name));
    head.appendChild(pill(s.state));
    head.appendChild(h("span", { class: "sp" }));
    head.appendChild(h("button", { class: "x", type: "button", "aria-label": "Close", onclick: closeDrawer }, "×"));
    var meta = clear($("dmeta"));
    meta.appendChild(h("div", { class: "dtitle" }, s.title));
    var kv = h("dl", { class: "kv" });
    [["agent", s.agent + (driverOf(s.agent) ? " (" + driverOf(s.agent) + ")" : "")],
      ["workspace", s.workspace], ["cwd", s.cwd], ["model", s.model || "agent default"],
      ["owner", s.owner || null],
      ["created", fullTime(s.createdAt) + " (" + ago(s.createdAt) + ")"],
      ["updated", fullTime(s.updatedAt) + " (" + ago(s.updatedAt) + ")"],
      ["process", s.live ? "running" : "none"]].forEach(function (r) {
      if (r[1] === null) return;
      kv.appendChild(h("dt", null, r[0]));
      kv.appendChild(h("dd", null, r[1]));
    });
    meta.appendChild(kv);
    var pend = clear($("dpending"));
    if (s.pending) {
      pend.appendChild(pendingBlock(s.pending, false));
      pend.appendChild(h("div", { class: "sub mono", style: "margin-top:4px" }, "request id " + s.pending.id));
    }
  }

  function fetchDetail() {
    var d = drawer;
    var name = d.name;
    var url = "/dashboard/api/sessions/" + encodeURIComponent(name) + (d.lastSeq > 0 ? "?since=" + d.lastSeq : "");
    return getJson(url).then(function (res) {
      if (d.name !== name) return;
      d.detail = res.session;
      d.missing = false;
      drawerMeta(res.session);
      var body = $("dbody");
      var stick = !d.loaded || body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      var list = $("timeline");
      if (res.truncated && !d.truncated) {
        d.truncated = true;
        $("dnote").textContent = "Earlier events are not shown (latest " + res.events.length + " of " + res.lastSeq + ").";
      }
      res.events.forEach(function (e) {
        if (d.seen[e.seq]) return;
        d.seen[e.seq] = true;
        var row = evRow(e);
        if (row) list.appendChild(row);
        d.lastSeq = Math.max(d.lastSeq, e.seq);
      });
      if (!res.events.length && !d.loaded) $("dnote").textContent = "No events yet.";
      else if (res.events.length && !res.truncated && !d.truncated) $("dnote").textContent = "";
      d.loaded = true;
      if (stick) body.scrollTop = body.scrollHeight;
      if (res.hasMore) return fetchDetail();
    }).catch(function (err) {
      if (d.name !== name) return;
      if (err.status === 404) {
        d.missing = true;
        $("dnote").textContent = "This session no longer exists or is not visible to you.";
      } else throw err;
    });
  }

  function openDrawer(name) {
    if (drawer.name === name) return;
    drawer = { name: name, lastSeq: 0, seen: {}, tools: {}, loaded: false, truncated: false, missing: false, detail: null };
    clear($("timeline"));
    $("dnote").textContent = "Loading…";
    var s = sessionByName(name);
    clear($("dhead")).appendChild(h("span", { class: "name" }, name));
    $("dhead").appendChild(h("span", { class: "sp" }));
    $("dhead").appendChild(h("button", { class: "x", type: "button", "aria-label": "Close", onclick: closeDrawer }, "×"));
    clear($("dmeta"));
    clear($("dpending"));
    if (s) drawer.detail = s;
    $("scrim").classList.add("open");
    $("drawer").classList.add("open");
    $("drawer").removeAttribute("inert");
    document.body.classList.add("locked");
    fetchDetail().then(function () { $("drawer").querySelector(".x").focus(); }).catch(function () {});
  }

  function closeDrawer() {
    if (location.hash.indexOf("#session/") === 0) location.hash = "#" + tab;
    else hideDrawer();
  }

  function hideDrawer() {
    if (!drawer.name) return;
    drawer.name = null;
    $("scrim").classList.remove("open");
    $("drawer").classList.remove("open");
    $("drawer").setAttribute("inert", "");
    document.body.classList.remove("locked");
  }

  function route() {
    var hash = location.hash;
    if (hash.indexOf("#session/") === 0) {
      openDrawer(decodeURIComponent(hash.slice(9)));
      return;
    }
    hideDrawer();
    var t = hash.slice(1);
    if (TABS.some(function (x) { return x[0] === t; }) && t !== tab) { tab = t; lastKey = ""; render(); }
  }

  function tick() {
    if (busy) return;
    busy = true;
    var p = fetchState();
    if (drawer.name) p = p.then(fetchDetail);
    p.then(function () { setStatus("live"); }, function (err) {
      setStatus(err.status === 403 ? "denied" : "offline", err.message);
    }).then(function () { busy = false; schedule(); });
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) { setStatus("paused"); return; }
    timer = setTimeout(tick, POLL_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { clearTimeout(timer); setStatus("paused"); }
    else { clearTimeout(timer); tick(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && drawer.name) closeDrawer(); });
  $("scrim").addEventListener("click", closeDrawer);
  window.addEventListener("hashchange", route);

  $("drawer").setAttribute("inert", "");
  var first = location.hash.slice(1);
  if (TABS.some(function (x) { return x[0] === first; })) tab = first;
  tick();
  route();
})();
</script>
</body>
</html>
`;

export const DASHBOARD_HTML = TEMPLATE.replaceAll("__ICON__", ICON_DATA_URI);
