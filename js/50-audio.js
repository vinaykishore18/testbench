/* Testbench — audio: microphone level, noise floor, clipping, record and playback; headset channels and sweep. */
"use strict";
var AUDIO = (function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp;

  var ac=null, micStream=null, micNode=null, ana=null, buf=null, freq=null, raf=null;
  var peak=0, floor=1, clips=0, samples=0, sumRms=0;
  var rec=null, chunks=[], blobUrl=null, audioEl=new Audio();
  function ctx(){ if(!ac) ac=new (window.AudioContext||window.webkitAudioContext)(); if(ac.state==="suspended") ac.resume(); return ac; }

  function dbfs(v){ return v<=0.00001? -Infinity : 20*Math.log10(v); }
  function fmtDb(v){ var d=dbfs(v); return d===-Infinity? "-∞" : d.toFixed(1); }

  function listDevices(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function(ds){
      var ins=ds.filter(function(d){return d.kind==="audioinput";});
      var s=$("#au-indev"); s.innerHTML="";
      ins.forEach(function(d,i){ var o=el("option",null,d.label||("Microphone "+(i+1))); o.value=d.deviceId; s.appendChild(o); });
      if(micStream){ var tr=micStream.getAudioTracks()[0]; if(tr&&tr.getSettings().deviceId) s.value=tr.getSettings().deviceId; }
      var cs=ds.filter(function(d){return d.kind==="videoinput";});
      var cv=$("#cam-dev"); cv.innerHTML="";
      cs.forEach(function(d,i){ var o=el("option",null,d.label||("Camera "+(i+1))); o.value=d.deviceId; cv.appendChild(o); });
      if(!cs.length) cv.appendChild(el("option",null,"No camera found"));
    }).catch(function(){});
  }

  function stopMic(){
    if(raf) cancelAnimationFrame(raf), raf=null;
    if(micStream) micStream.getTracks().forEach(function(t){t.stop();});
    micStream=null; micNode=null; TB.chip("mic",false,"off");
    $("#au-start").textContent="Start microphone"; $("#au-start").classList.remove("on");
    $("#au-rec").disabled=true;
  }
  function startMic(){
    var id=$("#au-indev").value;
    var c={audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}};
    if(id&&id.length>4) c.audio.deviceId={exact:id};
    navigator.mediaDevices.getUserMedia(c).then(function(s){
      micStream=s; var a=ctx();
      micNode=a.createMediaStreamSource(s);
      ana=a.createAnalyser(); ana.fftSize=2048; ana.smoothingTimeConstant=0.7;
      buf=new Float32Array(ana.fftSize); freq=new Uint8Array(ana.frequencyBinCount);
      micNode.connect(ana);
      peak=0; floor=1; clips=0; samples=0; sumRms=0;
      $("#au-sr").innerHTML=Math.round(a.sampleRate/100)/10+" <small>kHz</small>";
      $("#au-start").textContent="Stop microphone"; $("#au-start").classList.add("on");
      $("#au-rec").disabled=false;
      TB.chip("mic",true,"live"); TB.badge("audio","live",true);
      listDevices(); loop();
    }).catch(function(err){
      TB.toast("Microphone blocked", err.name==="NotAllowedError"?"Permission was denied. Allow the microphone for this page and try again.":"Could not open that microphone ("+err.name+").","bad");
    });
  }
  $("#au-start").onclick=function(){ micStream?stopMic():startMic(); };
  $("#au-indev").onchange=function(){ if(micStream){ stopMic(); startMic(); } };

  var scope=$("#au-scope"), sctx=scope.getContext("2d");
  var spec=$("#au-spec"), pctx=spec.getContext("2d");
  function fit(c){ var d=Math.min(2,window.devicePixelRatio||1); var w=c.clientWidth,h=c.clientHeight; if(c.width!==w*d){c.width=w*d;c.height=h*d;} c.getContext("2d").setTransform(d,0,0,d,0,0); return [w,h]; }

  function loop(){
    raf=requestAnimationFrame(loop);
    if(!ana) return;
    ana.getFloatTimeDomainData(buf);
    var sum=0,mx=0;
    for(var i=0;i<buf.length;i++){ var v=buf[i]; sum+=v*v; var av=Math.abs(v); if(av>mx)mx=av; if(av>=0.985) clips++; }
    var rms=Math.sqrt(sum/buf.length);
    samples++; sumRms+=rms;
    if(mx>peak) peak=mx;
    if(rms<floor&&samples>20) floor=rms;
    $("#au-lvl").innerHTML=fmtDb(rms)+" <small>dB</small>";
    var pk=$("#au-peak"); pk.innerHTML=fmtDb(peak)+" <small>dB</small>";
    pk.className="v "+(peak>0.985?"fail":peak>0.1?"pass":"warn");
    $("#au-floor").innerHTML=fmtDb(floor)+" <small>dB</small>";
    var cl=$("#au-clip"); cl.textContent=clips; cl.className="v"+(clips>200?" fail":clips>0?" warn":"");

    var d=fit(scope), w=d[0], h=d[1];
    sctx.clearRect(0,0,w,h);
    sctx.strokeStyle="#1E272C"; sctx.lineWidth=1;
    sctx.beginPath(); sctx.moveTo(0,h/2); sctx.lineTo(w,h/2); sctx.stroke();
    sctx.strokeStyle= peak>0.985?"#FF5C5C":"#3FD07E"; sctx.lineWidth=1.4; sctx.beginPath();
    for(var x=0;x<w;x++){
      var s=buf[Math.floor(x/w*buf.length)];
      var y=h/2 - s*(h/2-3);
      x?sctx.lineTo(x,y):sctx.moveTo(x,y);
    }
    sctx.stroke();

    ana.getByteFrequencyData(freq);
    var d2=fit(spec), w2=d2[0], h2=d2[1];
    pctx.clearRect(0,0,w2,h2);
    var bars=72;
    for(var b=0;b<bars;b++){
      var lo=Math.floor(Math.pow(b/bars,2)*freq.length), hi=Math.max(lo+1,Math.floor(Math.pow((b+1)/bars,2)*freq.length));
      var m=0; for(var k=lo;k<hi;k++) if(freq[k]>m)m=freq[k];
      var bh=(m/255)*(h2-4);
      pctx.fillStyle= m>230?"#F5A524":"#35C3D4";
      pctx.fillRect(b*(w2/bars)+1, h2-bh, (w2/bars)-2, bh);
    }
    micVerdict();
  }
  function micVerdict(){
    var f=[], s=100;
    var avg=samples?sumRms/samples:0;
    if(peak<0.005){ TB.verdict($("#au-verdict"),null,[],"Speak into the microphone — nothing is arriving yet."); return; }
    if(clips>200){ s-=35; f.push({level:"bad",tag:"clipping",text:clips+" clipped samples. The capsule or the gain is overloading — distorted recordings."}); }
    else if(clips>0){ s-=8; f.push({level:"warn",tag:"clipping",text:clips+" clipped samples. Back off the gain or speak further away."}); }
    else f.push({level:"ok",tag:"headroom",text:"No clipping. Peak "+fmtDb(peak)+" dB."});
    var fd=dbfs(floor);
    if(fd>-42){ s-=22; f.push({level:"bad",tag:"noise",text:"Noise floor sits at "+fd.toFixed(0)+" dB — audible hiss or hum even in silence."}); }
    else if(fd>-55){ s-=8; f.push({level:"warn",tag:"noise",text:"Noise floor "+fd.toFixed(0)+" dB. A little hissy but usable."}); }
    else f.push({level:"ok",tag:"noise",text:"Quiet floor at "+fd.toFixed(0)+" dB."});
    if(peak<0.06){ s-=20; f.push({level:"warn",tag:"level",text:"Peaks only reach "+fmtDb(peak)+" dB. Very low output — check the capsule and the cable."}); }
    else f.push({level:"ok",tag:"level",text:"Healthy peaks at "+fmtDb(peak)+" dB."});
    TB.verdict($("#au-verdict"),clamp(s,0,100),f);
  }

  /* record & play back */
  $("#au-rec").onclick=function(){
    if(!micStream) return;
    if(rec&&rec.state==="recording"){ rec.stop(); return; }
    chunks=[];
    try{ rec=new MediaRecorder(micStream); }catch(e){ TB.toast("Recording unavailable","This browser will not record from that device.","bad"); return; }
    rec.ondataavailable=function(e){ if(e.data.size) chunks.push(e.data); };
    rec.onstop=function(){
      if(blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl=URL.createObjectURL(new Blob(chunks,{type:rec.mimeType||"audio/webm"}));
      audioEl.src=blobUrl; $("#au-play").disabled=false;
      $("#au-rec").textContent="Record 6 s";
      TB.toast("Recorded","Play it back on the headset you are testing — that catches faults a meter will not.","ok");
    };
    rec.start(); $("#au-rec").textContent="Recording… stop";
    setTimeout(function(){ if(rec&&rec.state==="recording") rec.stop(); },6000);
  };
  $("#au-play").onclick=function(){ audioEl.currentTime=0; audioEl.play(); };

  /* ---- output tests ---- */
  var osc=null, gain=null, panner=null, outAna=null, outRaf=null, sweepT=null;
  function stopTone(){
    if(sweepT) clearInterval(sweepT), sweepT=null;
    if(osc){ try{osc.stop();}catch(e){} osc.disconnect(); osc=null; }
    if(outRaf) cancelAnimationFrame(outRaf), outRaf=null;
    $("#au-outl").style.width="0%"; $("#au-outr").style.width="0%";
    $("#au-outlv").textContent="0"; $("#au-outrv").textContent="0";
  }
  function tone(mode){
    stopTone();
    if(mode==="stop") return;
    var a=ctx();
    osc=a.createOscillator(); osc.type="sine"; osc.frequency.value=440;
    gain=a.createGain(); gain.gain.value=(parseInt($("#au-vol").value,10)/100)*0.35;
    panner=a.createStereoPanner? a.createStereoPanner():null;
    var splitter=a.createChannelSplitter(2);
    var aL=a.createAnalyser(), aR=a.createAnalyser(); aL.fftSize=512; aR.fftSize=512;
    var chain=osc; chain.connect(gain);
    var tail=gain;
    if(panner){ gain.connect(panner); tail=panner; }
    tail.connect(a.destination); tail.connect(splitter);
    splitter.connect(aL,0); splitter.connect(aR,1);
    if(panner) panner.pan.value = mode==="left"?-1: mode==="right"?1: 0;
    if(mode==="bass") osc.frequency.value=30;
    if(mode==="sweep") osc.frequency.value=20;
    osc.start();
    var t0=performance.now();
    if(mode==="sweep"){
      $("#au-sweeplbl").textContent="Sweeping…";
      osc.frequency.exponentialRampToValueAtTime(20000, a.currentTime+14);
      sweepT=setInterval(function(){
        var f=osc.frequency.value;
        $("#au-sweeplbl").textContent="Sweeping — "+(f<1000? Math.round(f)+" Hz" : (f/1000).toFixed(1)+" kHz")+". Listen for a gap, a buzz or a rattle.";
        if(performance.now()-t0>14500){ stopTone(); $("#au-sweeplbl").textContent="Sweep finished."; }
      },120);
    }
    if(mode==="bass"){
      osc.frequency.exponentialRampToValueAtTime(120, a.currentTime+8);
      sweepT=setInterval(function(){ if(performance.now()-t0>8500) stopTone(); },200);
    }
    if(mode==="pan"&&panner){
      panner.pan.setValueAtTime(-1,a.currentTime);
      panner.pan.linearRampToValueAtTime(1,a.currentTime+5);
      sweepT=setInterval(function(){ if(performance.now()-t0>5400) stopTone(); },150);
    }
    var bl=new Uint8Array(aL.frequencyBinCount), br=new Uint8Array(aR.frequencyBinCount);
    (function m(){
      outRaf=requestAnimationFrame(m);
      aL.getByteFrequencyData(bl); aR.getByteFrequencyData(br);
      function pk(arr){ var x=0; for(var i=0;i<arr.length;i++) if(arr[i]>x)x=arr[i]; return x/255; }
      var l=pk(bl), r=pk(br);
      $("#au-outl").style.width=(l*100)+"%"; $("#au-outr").style.width=(r*100)+"%";
      $("#au-outl").className=l>0.02?"pass":""; $("#au-outr").className=r>0.02?"pass":"";
      $("#au-outlv").textContent=(l*100).toFixed(0)+"%"; $("#au-outrv").textContent=(r*100).toFixed(0)+"%";
    })();
  }
  $$("[data-tone]").forEach(function(b){ b.onclick=function(){ tone(b.dataset.tone); }; });
  $("#au-vol").oninput=function(){ if(gain) gain.gain.value=(parseInt(this.value,10)/100)*0.35; };

  if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener){
    navigator.mediaDevices.addEventListener("devicechange",listDevices);
  }
  listDevices();
  TB.onLeave("audio",function(){ stopTone(); });
  return {listDevices:listDevices};

})();
