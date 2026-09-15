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

console.log('--- is it still being called a wheel? ---');
console.log('   Wheel chip:', await p.$eval('#chip-wheel', n=>n.textContent.trim()));
console.log('   Pads chip: ', await p.$eval('#chip-pad', n=>n.textContent.trim()));

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
console.log('\n--- what the Controllers page now shows ---');
console.log('   devices listed  :', JSON.stringify(r.selector));
console.log('   auto-selected   :', r.selected);
console.log('   hint            :', r.hint);
console.log('   fake pad drawing:', r.hasFakeDiagram, '(should be false)');
console.log('   explains why    :', r.nonStandardNote);
console.log('   buttons testable:', r.checklistItems, '(should be 14)');
console.log('   axis rows       :', r.axisRows, '(should be 10)');
console.log('   axes marked moved:', r.axesMoved);
console.log('   button chips    :', r.buttonChips);
console.log(errs.length?'\nERRORS:\n'+errs.join('\n'):'\nno errors');
await b.close();
