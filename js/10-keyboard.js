/* Testbench — keyboard: real physical layouts, capture mode, chatter and stuck-key detection. */
"use strict";
(function () {
var $=TB.$, $$=TB.$$, el=TB.el, clamp=TB.clamp, esc=TB.esc, verdict=TB.verdict, badge=TB.badge, toast=TB.toast;
/* ============================================================
   KEYBOARD
   ============================================================ */
var KB=(function(){
  var NUMROW=[["Backquote","`","~"],["Digit1","1","!"],["Digit2","2","@"],["Digit3","3","#"],["Digit4","4","$"],
    ["Digit5","5","%"],["Digit6","6","^"],["Digit7","7","&"],["Digit8","8","*"],["Digit9","9","("],["Digit0","0",")"],
    ["Minus","-","_"],["Equal","=","+"]];
  var QROW=[["KeyQ","Q"],["KeyW","W"],["KeyE","E"],["KeyR","R"],["KeyT","T"],["KeyY","Y"],["KeyU","U"],["KeyI","I"],
    ["KeyO","O"],["KeyP","P"],["BracketLeft","[","{"],["BracketRight","]","}"]];
  var AROW=[["KeyA","A"],["KeyS","S"],["KeyD","D"],["KeyF","F"],["KeyG","G"],["KeyH","H"],["KeyJ","J"],["KeyK","K"],
    ["KeyL","L"],["Semicolon",";",":"],["Quote","'",'"']];
  var ZROW=[["KeyZ","Z"],["KeyX","X"],["KeyC","C"],["KeyV","V"],["KeyB","B"],["KeyN","N"],["KeyM","M"],
    ["Comma",",","<"],["Period",".",">"],["Slash","/","?"]];

  function K(c,x,y,w,h,lbl,sub,cls){ return {c:c,x:x,y:y,w:w||1,h:h||1,lbl:lbl,sub:sub,cls:cls}; }

  function fnRow(y){
    var a=[K("Escape",0,y,1,1,"Esc")];
    for(var i=1;i<=12;i++){
      var x = i<=4 ? 1+i : i<=8 ? 1.5+i : 2+i;
      a.push(K("F"+i,x,y,1,1,"F"+i));
    }
    return a;
  }
  function alphaBlock(iso,arrows,y0){
    var a=[],x;
    x=0; NUMROW.forEach(function(d){ a.push(K(d[0],x,y0,1,1,d[1],d[2])); x++; });
    a.push(K("Backspace",x,y0,2,1,"Backspace"));
    x=1.5; a.push(K("Tab",0,y0+1,1.5,1,"Tab"));
    QROW.forEach(function(d){ a.push(K(d[0],x,y0+1,1,1,d[1],d[2])); x++; });
    if(iso) a.push(K("Enter",13.5,y0+1,1.5,2,"Enter",null,"isoent"));
    else    a.push(K("Backslash",13.5,y0+1,1.5,1,"\\","|"));
    x=1.75; a.push(K("CapsLock",0,y0+2,1.75,1,"Caps"));
    AROW.forEach(function(d){ a.push(K(d[0],x,y0+2,1,1,d[1],d[2])); x++; });
    if(iso) a.push(K("Backslash",12.75,y0+2,1,1,"#","~"));
    else    a.push(K("Enter",12.75,y0+2,2.25,1,"Enter"));
    if(iso){ a.push(K("ShiftLeft",0,y0+3,1.25,1,"Shift")); a.push(K("IntlBackslash",1.25,y0+3,1,1,"\\","|")); }
    else     a.push(K("ShiftLeft",0,y0+3,2.25,1,"Shift"));
    x=2.25; ZROW.forEach(function(d){ a.push(K(d[0],x,y0+3,1,1,d[1],d[2])); x++; });
    if(arrows){
      a.push(K("ShiftRight",12.25,y0+3,1.75,1,"Shift"));
      a.push(K("ArrowUp",14,y0+3,1,1,"↑"));
      a.push(K("ControlLeft",0,y0+4,1.25,1,"Ctrl"));
      a.push(K("MetaLeft",1.25,y0+4,1.25,1,"Win"));
      a.push(K("AltLeft",2.5,y0+4,1.25,1,"Alt"));
      a.push(K("Space",3.75,y0+4,6.25,1,"Space"));
      a.push(K("AltRight",10,y0+4,1,1,"Alt"));
      a.push(K("Fn",11,y0+4,1,1,"Fn",null,"nofn"));
      a.push(K("ArrowLeft",12,y0+4,1,1,"←"));
      a.push(K("ArrowDown",13,y0+4,1,1,"↓"));
      a.push(K("ArrowRight",14,y0+4,1,1,"→"));
    } else {
      a.push(K("ShiftRight",12.25,y0+3,2.75,1,"Shift"));
      a.push(K("ControlLeft",0,y0+4,1.25,1,"Ctrl"));
      a.push(K("MetaLeft",1.25,y0+4,1.25,1,"Win"));
      a.push(K("AltLeft",2.5,y0+4,1.25,1,"Alt"));
      a.push(K("Space",3.75,y0+4,6.25,1,"Space"));
      a.push(K("AltRight",10,y0+4,1.25,1,"Alt"));
      a.push(K("MetaRight",11.25,y0+4,1.25,1,"Win"));
      a.push(K("ContextMenu",12.5,y0+4,1.25,1,"Menu"));
      a.push(K("ControlRight",13.75,y0+4,1.25,1,"Ctrl"));
    }
    return a;
  }
  function navCluster(x0){
    return [K("PrintScreen",x0,0,1,1,"Prt Sc",null,"tiny"),K("ScrollLock",x0+1,0,1,1,"Scr Lk",null,"tiny"),K("Pause",x0+2,0,1,1,"Pause",null,"tiny"),
      K("Insert",x0,1.25,1,1,"Ins"),K("Home",x0+1,1.25,1,1,"Home"),K("PageUp",x0+2,1.25,1,1,"Pg Up",null,"tiny"),
      K("Delete",x0,2.25,1,1,"Del"),K("End",x0+1,2.25,1,1,"End"),K("PageDown",x0+2,2.25,1,1,"Pg Dn",null,"tiny"),
      K("ArrowUp",x0+1,4.25,1,1,"↑"),
      K("ArrowLeft",x0,5.25,1,1,"←"),K("ArrowDown",x0+1,5.25,1,1,"↓"),K("ArrowRight",x0+2,5.25,1,1,"→")];
  }
  function numpadBlock(x0,y0){
    return [K("NumLock",x0,y0,1,1,"Num"),K("NumpadDivide",x0+1,y0,1,1,"/"),K("NumpadMultiply",x0+2,y0,1,1,"*"),K("NumpadSubtract",x0+3,y0,1,1,"−"),
      K("Numpad7",x0,y0+1,1,1,"7"),K("Numpad8",x0+1,y0+1,1,1,"8"),K("Numpad9",x0+2,y0+1,1,1,"9"),K("NumpadAdd",x0+3,y0+1,1,2,"+"),
      K("Numpad4",x0,y0+2,1,1,"4"),K("Numpad5",x0+1,y0+2,1,1,"5"),K("Numpad6",x0+2,y0+2,1,1,"6"),
      K("Numpad1",x0,y0+3,1,1,"1"),K("Numpad2",x0+1,y0+3,1,1,"2"),K("Numpad3",x0+2,y0+3,1,1,"3"),K("NumpadEnter",x0+3,y0+3,1,2,"Enter"),
      K("Numpad0",x0,y0+4,2,1,"0"),K("NumpadDecimal",x0+2,y0+4,1,1,".")];
  }
  var LAYOUTS={
    ansi_full:function(){ return fnRow(0).concat(alphaBlock(false,false,1.25),navCluster(15.25),numpadBlock(18.5,1.25)); },
    iso_full: function(){ return fnRow(0).concat(alphaBlock(true ,false,1.25),navCluster(15.25),numpadBlock(18.5,1.25)); },
    ansi_tkl: function(){ return fnRow(0).concat(alphaBlock(false,false,1.25),navCluster(15.25)); },
    iso_tkl:  function(){ return fnRow(0).concat(alphaBlock(true ,false,1.25),navCluster(15.25)); },
    c75:      function(){ return fnRow(0).concat(alphaBlock(false,true,1.25),
                 [K("Delete",15.25,0,1,1,"Del"),K("Home",15.25,1.25,1,1,"Home"),K("PageUp",15.25,2.25,1,1,"Pg Up"),
                  K("PageDown",15.25,3.25,1,1,"Pg Dn"),K("End",15.25,4.25,1,1,"End")]); },
    c65:      function(){ return alphaBlock(false,true,0).concat(
                 [K("Delete",15.25,0,1,1,"Del"),K("PageUp",15.25,1,1,1,"Pg Up"),K("PageDown",15.25,2,1,1,"Pg Dn")]); },
    c60:      function(){ return alphaBlock(false,false,0); },
    laptop:   function(){ return fnRow(0).concat(alphaBlock(false,true,1.25)); },
    numpad:   function(){ return numpadBlock(0,0); }
  };

  var wrap=$("#kbwrap"), kb=null, keyEls={}, layout="ansi_full", layoutMap=null;
  var state=fresh();
  function fresh(){ var b=function(){return Object.create(null);};
    return {down:b(),downAt:b(),lastUp:b(),tested:b(),chatter:b(),presses:0,chat:0,stuck:b(),nkro:0,fastest:null}; }

  function build(){
    wrap.innerHTML=""; keyEls={};
    kb=el("div","tb-kb");
    kb.style.setProperty("--u",($("#kb-size").value||42)+"px");
    var defs=LAYOUTS[layout](), maxX=0, maxY=0;
    defs.forEach(function(d){
      maxX=Math.max(maxX,d.x+d.w); maxY=Math.max(maxY,d.y+d.h);
      var k=el("div","tb-key"+(d.cls?" "+d.cls:"")+(d.w>=1.5?" wide":""));
      k.style.left="calc(var(--u) * "+d.x+")";
      k.style.top="calc(var(--u) * "+d.y+")";
      k.style.width="calc(var(--u) * "+d.w+" - 4px)";
      k.style.height="calc(var(--u) * "+d.h+" - 4px)";
      var lbl=d.lbl, sub=d.sub;
      if(layoutMap&&layoutMap.get){
        var m=layoutMap.get(d.c);
        if(m&&m.length<=2){
          var mm = m.length===1 ? m.toUpperCase() : m;
          if(mm!==lbl){ lbl=mm; sub=null; }
        }
      }
      if(sub) k.appendChild(el("span","sub",sub));
      k.appendChild(el("span","main",lbl));
      if(d.cls!=="nofn"){
        k.dataset.code=d.c;
        (keyEls[d.c]=keyEls[d.c]||[]).push(k);
      } else {
        k.title="No browser reports the Fn key — it is handled inside the keyboard itself.";
      }
      kb.appendChild(k);
    });
    kb.style.width="calc(var(--u) * "+maxX+")";
    kb.style.height="calc(var(--u) * "+maxY+")";
    wrap.appendChild(kb);
    repaint(); stats();
  }
  function each(code,fn){ (keyEls[code]||[]).forEach(fn); }
  function repaint(){
    Object.keys(keyEls).forEach(function(code){
      each(code,function(k){
        k.classList.toggle("hit",!!state.down[code]);
        k.classList.toggle("done",!state.down[code]&&!!state.tested[code]);
        k.classList.toggle("stuck",!!state.stuck[code]);
        k.classList.toggle("chatter",!!state.chatter[code]);
      });
    });
  }
  function nice(code){
    var e=keyEls[code]; if(e&&e[0]){ var m=e[0].querySelector(".main"); if(m) return m.textContent; }
    return code;
  }
  function log(strong,line){
    var d=el("div"); d.appendChild(el("b",null,strong)); d.appendChild(document.createTextNode(" "+line));
    var box=$("#kb-log"); box.insertBefore(d,box.firstChild);
    while(box.childElementCount>140) box.lastChild.remove();
  }
  function stats(){
    var total=Object.keys(keyEls).length;
    var done=Object.keys(state.tested).filter(function(c){return keyEls[c];}).length;
    $("#kb-tested").innerHTML=done+"<small> / "+total+"</small>";
    $("#kb-tested").className="v"+(total&&done===total?" pass":"");
    $("#kb-presses").textContent=state.presses;
    $("#kb-nkro").textContent=state.nkro;
    var ch=$("#kb-chatter"); ch.textContent=state.chat; ch.className="v"+(state.chat?" fail":"");
    var sc=Object.keys(state.stuck).length;
    var sk=$("#kb-stuck"); sk.textContent=sc; sk.className="v"+(sc?" fail":"");
    $("#kb-fast").textContent=state.fastest==null?"—":state.fastest+" ms";
    if(state.presses===0){ verdict($("#kb-verdict"),null,[],"Start capture mode and press every key once."); badge("keyboard",""); return; }
    var flags=[], score=100;
    if(state.chat){ score-=Math.min(45,state.chat*9); flags.push({level:"bad",tag:"chatter",text:state.chat+" bounce event"+(state.chat>1?"s":"")+" — a switch is double-firing. Keys involved: "+Object.keys(state.chatter).map(nice).join(", ")+"."}); }
    if(sc){ score-=40; flags.push({level:"bad",tag:"stuck",text:"Stuck: "+Object.keys(state.stuck).map(nice).join(", ")+"."}); }
    if(total&&done<total){ var miss=total-done; score-=Math.min(30,miss*1.2); flags.push({level:"warn",tag:"untested",text:miss+" key"+(miss>1?"s":"")+" not pressed yet. A dead key looks exactly like an untested one."}); }
    else if(total) flags.push({level:"ok",tag:"coverage",text:"Every key in this layout responded."});
    if(state.nkro>=6) flags.push({level:"ok",tag:"rollover",text:state.nkro+" keys registered at once — full n-key rollover territory."});
    else if(state.nkro>0) flags.push({level:"ok",tag:"rollover",text:"Best simultaneous press so far: "+state.nkro+" keys."});
    verdict($("#kb-verdict"),clamp(score,0,100),flags);
    badge("keyboard",done+"/"+total,total&&done===total&&!state.chat&&!sc);
  }

  /* capture mode */
  var locked=false, escStart=0, escTimer=null;
  function setLocked(v){
    locked=v; document.body.classList.toggle("tb-locked",v);
    $("#kb-lock").textContent=v?"Exit capture mode":"Start capture mode";
    $("#kb-lock").classList.toggle("on",v);
  }
  function enter(){
    var root=document.documentElement;
    var p=root.requestFullscreen?root.requestFullscreen():Promise.reject();
    p.then(function(){
      if(navigator.keyboard&&navigator.keyboard.lock){
        return navigator.keyboard.lock().then(function(){
          $("#kb-lockstate").textContent="Full key hold is active. Windows/Command, Alt+Tab, Escape and the F-row are all being delivered to this page instead of the operating system.";
        });
      }
      $("#kb-lockstate").textContent="Full screen is on, but this browser has no key-hold support. Chrome, Edge or Opera will also hold Windows/Command and Alt+Tab.";
    }).catch(function(){
      $("#kb-lockstate").textContent="Full screen was refused, so the page can only hold the keys the browser gives it. Every key is still read and logged.";
    });
    setLocked(true);
  }
  function exit(){
    setLocked(false);
    try{ if(navigator.keyboard&&navigator.keyboard.unlock) navigator.keyboard.unlock(); }catch(e){}
    if(document.fullscreenElement&&document.exitFullscreen) document.exitFullscreen().catch(function(){});
    $("#escfill").style.width="0%";
  }
  $("#kb-lock").onclick=function(){ locked?exit():enter(); };
  document.addEventListener("fullscreenchange",function(){ if(!document.fullscreenElement&&locked) setLocked(false); });

  function isTyping(e){ var t=e.target; return t&&(t.tagName==="INPUT"||t.tagName==="SELECT"||t.tagName==="TEXTAREA"); }
  window.addEventListener("keydown",function(e){
    if(isTyping(e)) return;
    if(e.code==="KeyQ"&&e.ctrlKey&&e.shiftKey){ e.preventDefault(); exit(); return; }
    if(TB.view()!=="keyboard") return;
    e.preventDefault(); e.stopPropagation();
    if(e.code==="Escape"&&locked&&!escStart){
      escStart=performance.now();
      escTimer=setInterval(function(){
        var p=clamp((performance.now()-escStart)/1000,0,1);
        $("#escfill").style.width=(p*100)+"%";
        if(p>=1){ clearInterval(escTimer); escTimer=null; escStart=0; exit(); }
      },30);
    }
    if(e.repeat) return;
    var code=e.code||("Key_"+e.keyCode), now=performance.now();
    if(state.lastUp[code]!=null){
      var gap=now-state.lastUp[code];
      if(state.fastest==null||gap<state.fastest) state.fastest=Math.round(gap);
      if(gap<35){ state.chat++; state.chatter[code]=true; log("CHATTER "+nice(code),"bounced "+Math.round(gap)+" ms after release"); }
    }
    state.down[code]=true; state.downAt[code]=now; state.tested[code]=true; state.presses++;
    var n=Object.keys(state.down).length; if(n>state.nkro) state.nkro=n;
    if(!keyEls[code]) log("EXTRA","code "+code+" · key “"+(e.key||"")+"” · keyCode "+e.keyCode+" — not on this layout");
    repaint(); stats();
  },true);
  window.addEventListener("keyup",function(e){
    if(isTyping(e)) return;
    if(e.code==="Escape"&&escTimer){ clearInterval(escTimer); escTimer=null; escStart=0; $("#escfill").style.width="0%"; }
    if(TB.view()!=="keyboard") return;
    e.preventDefault();
    var code=e.code||("Key_"+e.keyCode);
    delete state.down[code]; delete state.stuck[code];
    state.lastUp[code]=performance.now();
    repaint(); stats();
  },true);
  setInterval(function(){
    var now=performance.now(), ch=false;
    Object.keys(state.down).forEach(function(c){
      if(now-state.downAt[c]>5000&&!state.stuck[c]){ state.stuck[c]=true; ch=true; log("STUCK "+nice(c),"held over 5 s with no release"); }
    });
    if(ch){ repaint(); stats(); }
  },700);

  $("#kb-layout").onchange=function(){ layout=this.value; build(); };
  $("#kb-reset").onclick=function(){ state=fresh(); $("#kb-log").innerHTML=""; repaint(); stats(); };
  $("#kb-size").oninput=function(){ if(kb) kb.style.setProperty("--u",this.value+"px"); };

  TB.hidMount("#kb-id","Plug the keyboard in and press this to read its product name. Plain office keyboards are hidden by the browser for security; gaming and programmable models normally show up.");
  if(navigator.keyboard&&navigator.keyboard.getLayoutMap){
    navigator.keyboard.getLayoutMap().then(function(m){
      layoutMap=m; build();
      var q=m.get("KeyQ"), y=m.get("KeyY"), z=m.get("KeyZ");
      var name = (q==="a")?"AZERTY":(z==="y"||y==="z")?"QWERTZ":(q==="'")?"Dvorak":"QWERTY";
      var box=$("#kb-id");
      var s=el("span","name"); s.innerHTML="Operating-system layout: <b>"+esc(name)+"</b> — key legends below match it";
      box.appendChild(s);
    }).catch(function(){});
  }
  build();
  return {exit:exit,isLocked:function(){return locked;}};
})();

window.KB=KB;
})();

/* ============================================================
   Keyboard extras — typing test, rollover, shortcut capture
   ============================================================ */
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp;
var pane = "layout";
TB.tabs("#kb-tabs", "data-kbpane", function (n) { pane = n; });
var stepTo = TB.steps("#kb-steps");
stepTo(1);

if (TB.isCoarse()) {
  $("#kb-mobile").appendChild(TB.callout("Keyboard testing needs a physical keyboard. On a phone the on-screen keyboard reports almost nothing — plug this page into a computer for a real test."));
}

/* ---------------- typing test ---------------- */
(function () {
  var LINES = [
    "The quick brown fox jumps over the lazy dog while the keyboard records every single keystroke.",
    "Pack my box with five dozen liquor jugs; then check that every letter still registers cleanly.",
    "Amazingly few discotheques provide jukeboxes, but a worn switch will still double up on you.",
    "How vexingly quick daft zebras jump when a refurbished board finally passes its bench test.",
    "Sphinx of black quartz, judge my vow — and judge this keyboard by whether it drops a letter."
  ];
  var sample = "", started = 0, mistyped = {}, done = false, timer = null;
  var out = $("#ty-sample"), input = $("#ty-input");

  function pick() {
    sample = LINES[Math.floor(Math.random() * LINES.length)];
    render("");
    input.value = ""; started = 0; mistyped = {}; done = false;
    if (timer) { clearInterval(timer); timer = null; }
    $("#ty-wpm").textContent = "—"; $("#ty-acc").textContent = "—";
    $("#ty-err").textContent = "0"; $("#ty-time").textContent = "0";
  }
  function render(typed) {
    out.textContent = "";
    for (var i = 0; i < sample.length; i++) {
      var sp = el("span", null, sample[i]);
      if (i < typed.length) {
        var ok = typed[i] === sample[i];
        sp.style.color = ok ? "var(--pass)" : "#140005";
        if (!ok) { sp.style.background = "var(--red)"; sp.style.borderRadius = "3px"; }
      } else if (i === typed.length) {
        sp.style.borderBottom = "2px solid var(--red)";
      } else {
        sp.style.color = "var(--ink-3)";
      }
      out.appendChild(sp);
    }
  }
  input.addEventListener("input", function () {
    var typed = input.value;
    if (!started && typed.length) {
      started = performance.now();
      timer = setInterval(function () {
        $("#ty-time").textContent = ((performance.now() - started) / 1000).toFixed(0);
      }, 200);
    }
    for (var i = 0; i < typed.length && i < sample.length; i++) {
      if (typed[i] !== sample[i]) mistyped[i] = true;
    }
    render(typed);
    var errs = Object.keys(mistyped).length;
    $("#ty-err").textContent = errs;
    var mins = started ? (performance.now() - started) / 60000 : 0;
    if (mins > 0) {
      var wpm = (typed.length / 5) / mins;
      $("#ty-wpm").textContent = Math.round(wpm);
      var acc = typed.length ? clamp((typed.length - errs) / typed.length * 100, 0, 100) : 100;
      var a = $("#ty-acc");
      a.textContent = acc.toFixed(1) + "%";
      a.className = "v " + (acc > 97 ? "pass" : acc > 90 ? "warn" : "fail");
    }
    if (typed.length >= sample.length && !done) {
      done = true;
      if (timer) { clearInterval(timer); timer = null; }
      TB.toast("Line finished", Object.keys(mistyped).length + " mistake(s). A board that drops or repeats letters shows up here first.", Object.keys(mistyped).length ? null : "ok");
    }
  });
  $("#ty-new").onclick = pick;
  $("#ty-reset").onclick = pick;
  pick();
})();

/* ---------------- rollover + shortcuts ---------------- */
(function () {
  var held = Object.create(null), maxN = 0;
  var box = $("#ro-keys");
  var downAt = {}, repFirst = null, repLast = 0, repGaps = [];
  function paint() {
    var codes = Object.keys(held);
    if (codes.length > maxN) maxN = codes.length;
    $("#ro-now").textContent = codes.length;
    var m = $("#ro-max"); m.textContent = maxN;
    m.className = "v " + (maxN >= 6 ? "pass" : maxN >= 4 ? "warn" : "");
    var v = $("#ro-verdict");
    if (!maxN) { v.textContent = "—"; v.className = "v"; }
    else if (maxN >= 6) { v.textContent = "N-key rollover"; v.className = "v pass"; }
    else if (maxN >= 4) { v.textContent = "4-key rollover"; v.className = "v warn"; }
    else { v.textContent = "2-key — membrane"; v.className = "v fail"; }
    box.textContent = "";
    codes.forEach(function (c) {
      var chip = el("div", "tb-btnchip down");
      chip.appendChild(el("div", null, "HELD"));
      chip.appendChild(el("b", null, c.replace(/^Key|^Digit/, "")));
      box.appendChild(chip);
    });
  }
  function combo(e) {
    var parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    var k = e.key;
    if (["Control", "Alt", "Shift", "Meta"].indexOf(k) === -1) {
      parts.push(k === " " ? "Space" : (k.length === 1 ? k.toUpperCase() : k));
    }
    return parts.join(" + ") || "—";
  }
  window.addEventListener("keydown", function (e) {
    if (TB.view() !== "keyboard") return;
    var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    var code = e.code || e.key;
    if (pane === "rollover") {
      if (!e.repeat) {
        held[code] = true; downAt[code] = performance.now();
        repFirst = null; repLast = 0; repGaps = [];
        paint();
      } else {
        var now = performance.now();
        if (repFirst === null && downAt[code]) {
          repFirst = now - downAt[code];
          $("#ro-delay").textContent = Math.round(repFirst) + " ms";
        } else if (repLast) {
          repGaps.push(now - repLast);
          if (repGaps.length > 20) repGaps.shift();
          var avg = repGaps.reduce(function (a, b) { return a + b; }, 0) / repGaps.length;
          $("#ro-rate").textContent = (1000 / avg).toFixed(1) + " /s";
        }
        repLast = now;
      }
      var c = combo(e);
      $("#sc-display").textContent = c;
      if (!e.repeat) {
        var d = el("div");
        d.appendChild(el("b", null, TB.stamp()));
        d.appendChild(document.createTextNode("  " + c + "   [code " + (e.code || "?") + "]"));
        var lg = $("#sc-log");
        lg.insertBefore(d, lg.firstChild);
        while (lg.childElementCount > 80) lg.lastChild.remove();
      }
    }
  }, true);
  window.addEventListener("keyup", function (e) {
    if (TB.view() !== "keyboard") return;
    delete held[e.code || e.key];
    if (pane === "rollover") paint();
  }, true);
  window.addEventListener("blur", function () { held = Object.create(null); if (pane === "rollover") paint(); });
  $("#ro-reset").onclick = function () { held = Object.create(null); maxN = 0; $("#sc-log").textContent = ""; $("#sc-display").textContent = "Press any key combination"; paint(); };
  paint();
})();

/* ---------------- step progress on the layout pane ---------------- */
$("#kb-layout").addEventListener("change", function () { stepTo(2); });
$("#kb-lock").addEventListener("click", function () { setTimeout(function () { stepTo(3); }, 50); });
})();
