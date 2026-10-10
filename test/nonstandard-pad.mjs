/* Regression test for a real controller that broke the page:
 * a Novablade leverless pad — non-standard mapping, 14 buttons, 10 axes, and a
 * separate wireless receiver that enumerates first and never sends anything.
 *
 * It used to be classified as a racing wheel, the page auto-selected the silent
 * receiver, and it drew an Xbox pad that bore no relation to the device.
 *
 *   node test/nonstandard-pad.mjs
 */
import { chromium } from 'playwright';
const CHROME = process.env.TB_CHROME || undefined;

/* This file printed its observations with "(should be 14)" beside them and
   exited 0 whatever it saw - so the one suite named after a specific
   controller that broke the page could never report that it had broken again.
   That is the same anti-pattern as the contrast gate that sat at 2.6 while
   claiming to check for 4.5: it reads as a pass and is not one. The
   expectations are assertions now. */
let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);
const b = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errs=[]; const p = await b.newPage({viewport:{width:1500,height:1000}});
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('console',m=>{const t=m.text(); if(m.type()==='error'&&!/fonts\.googleapis|Failed to load/.test(t))errs.push(t);});

/* reproduce exactly what the photo shows: a silent receiver in slot 0 and the
   real leverless pad in slot 1, non-standard, 14 buttons, 10 axes */
await p.addInitScript(() => {
  const mk = (index,id,nb,na,axes) => ({index,id,mapping:"",connected:true,timestamp:performance.now(),
    axes: axes || new Array(na).fill(0),
    buttons: Array.from({length:nb},()=>({pressed:false,touched:false,value:0})), vibrationActuator:null});
  window.__pads = [
    mk(0,"NOVABLADE 2.4 GHZ RECEIVER",8,4),
    mk(1,"Novablade PRO Wireless Hall Effect Leverless Controller (Vendor: 1b1c Product: 2b26)",14,10,
       [0.00392,0.00392,0.00392,-1,-1,0.00392,0,0,0,3.28571])
  ];
  navigator.getGamepads = () => window.__pads;
});
await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(1500);

console.log('\n1. it is not mistaken for a racing wheel');
{
  const wheel = await p.$eval('#chip-wheel', n => n.textContent.trim());
  const pads = await p.$eval('#chip-pad', n => n.textContent.trim());
  /* Ten axes used to be enough to classify it as a wheel, which sent it to
     the wrong page entirely. */
  /\u2014|—|0/.test(wheel) ? pass('wheel chip is empty: ' + JSON.stringify(wheel))
    : fail('still classified as a wheel: ' + JSON.stringify(wheel));
  /2/.test(pads) ? pass('both pads counted: ' + JSON.stringify(pads))
    : fail('pad count is ' + JSON.stringify(pads) + ', expected 2');
}

await p.click('button[data-view="gamepad"]'); await p.waitForTimeout(700);
/* make the pad send something so it counts as live */
await p.evaluate(()=>{ window.__pads[1].buttons[3]={pressed:true,touched:true,value:1}; });
await p.waitForTimeout(700);
await p.evaluate(()=>{ window.__pads[1].buttons[3]={pressed:false,touched:false,value:0};
                       window.__pads[1].axes[9] = -1.0; });   // move axis 9
await p.waitForTimeout(700);

const r = await p.evaluate(()=>{
  const v=document.querySelector('#view-gamepad');
  const sel=[...document.querySelectorAll('#gp-sel button')].map(b=>b.textContent.trim());
  return {
    selector: sel,
    selected: (document.querySelector('#gp-sel button.on')||{}).textContent,
    hint: document.querySelector('#gp-selhint').textContent.trim().slice(0,80),
    hasFakeDiagram: !!v.querySelector('.tb-dev'),
    nonStandardNote: /non-standard layout/.test(v.innerText),
    checklistItems: v.querySelectorAll('.tb-check li').length,
    axisRows: v.querySelectorAll('.tb-meterrow').length,
    axesMoved: v.querySelectorAll('.tb-meterrow.seen').length,
    buttonChips: v.querySelectorAll('.tb-gbtn').length
  };
});
console.log('\n2. the real pad is selected, not the silent receiver');
{
  r.selector.length === 2 ? pass('both devices listed') : fail(`${r.selector.length} devices listed: ${JSON.stringify(r.selector)}`);
  /* The receiver enumerates first and never sends anything. Auto-selecting it
     left the page apparently dead while the operator pressed buttons. */
  /Leverless|Novablade PRO/.test(r.selected || '')
    ? pass('auto-selected the pad that actually sends input')
    : fail('auto-selected ' + JSON.stringify(r.selected));
  /quiet/.test(r.selector.join(' '))
    ? pass('and the silent one is marked quiet in the list') : fail('the silent receiver is not marked: ' + JSON.stringify(r.selector));
}

console.log('\n3. it does not draw a controller it is not');
{
  /* It used to render an Xbox pad diagram that bore no relation to a
     leverless board - which is worse than drawing nothing, because the
     operator then looks for buttons that do not exist on the device. */
  !r.hasFakeDiagram ? pass('no invented pad diagram') : fail('a stock pad diagram is being drawn for a non-standard device');
  r.nonStandardNote ? pass('and the page explains that the layout is non-standard')
    : fail('nothing tells the operator why there is no diagram');
}

console.log('\n4. every button and axis the device reports is testable');
{
  r.checklistItems === 14 ? pass('14 buttons listed') : fail(`${r.checklistItems} buttons listed, the device reports 14`);
  r.axisRows === 10 ? pass('10 axis rows') : fail(`${r.axisRows} axis rows, the device reports 10`);
  r.buttonChips === 14 ? pass('14 button chips') : fail(`${r.buttonChips} button chips, expected 14`);
  /* Axis 9 was moved from its 3.28 rest value to -1 during the run. */
  r.axesMoved >= 1 ? pass(`${r.axesMoved} axis marked as having moved`)
    : fail('moving axis 9 was not noticed - a hat axis at a non-zero rest value is the case this device exposes');
}

console.log('\n5. no errors');
errs.length ? errs.slice(0, 6).forEach(fail) : pass('clean');

await b.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
