import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const requireWeb=createRequire(path.resolve('apps/web/package.json'));
const {chromium,expect}=requireWeb('@playwright/test');
const AxeBuilder=requireWeb('@axe-core/playwright').default;
let browser;
(async()=>{
const out=process.argv[2];if(!out)throw new Error('Pass an evidence output directory');fs.mkdirSync(out,{recursive:true});
browser=await chromium.launch({headless:true});const results=[];
for(const [name,width,height] of [['desktop',1440,1024],['mobile',390,844]]){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',isMobile:name==='mobile',hasTouch:name==='mobile'});
 const page=await context.newPage();
 for(const [surface,id,label] of [
 ['checkout','pages-guide-payment--ready','Без подписки и доплат'],
 ['product','pages-guide-ai-first--desktop','Моя помощь в сообществе'],
 ['offer','pages-legal-документ--purchase-offer','Что входит в сопровождение']
 ]){
  await page.goto(`${process.env.STORYBOOK_URL ?? "http://127.0.0.1:3401"}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`,{waitUntil:'domcontentloaded'});
  await expect(page.getByText(label,{exact:true}).first()).toBeVisible({timeout:30000});
  await page.addStyleTag({content:'[data-agentation-root] { display: none !important; }'});
  await page.screenshot({path:`${out}/${surface}-${name}.png`,fullPage:true});
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  const serious=axe.violations.filter(v=>['serious','critical'].includes(v.impact));
  const text=await page.evaluate(()=>document.body.innerText);
  results.push({surface,viewport:name,id,label,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),
   oldPromises:['без ограничения срока','всё время твоего участия','Навсегда','Всё включено'].filter(phrase=>text.includes(phrase)),
   serious:serious.map(v=>({id:v.id,impact:v.impact}))});
 }
 await context.close();
}
await browser.close();fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>browser?.close());
