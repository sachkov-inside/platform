async page => {
  const results = [];
  const writes = [];
  page.on('request', request => { if (!['GET','HEAD'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.method() + ' ' + request.url()); });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  for (const variant of ['a-labels','b-compact']) {
    for (const width of [1440,1024,820,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.goto(`http://localhost:6019/iframe.html?id=prototypes-1591-reader-actions--${variant}&viewMode=story`);
      const top = page.getByRole('navigation',{name:'Действия материала',exact:true});
      const bottom = page.getByRole('navigation',{name:'Действия в конце материала',exact:true});
      await top.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const measurements = await page.evaluate(() => ({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth, panels:[...document.querySelectorAll('[data-prototype-actions]')].map(panel => ({client:panel.clientWidth,scroll:panel.scrollWidth,buttons:[...panel.querySelectorAll('button')].map(b=>({name:b.getAttribute('aria-label'),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))}))}));
      assert(measurements.width === measurements.scroll, `${variant} ${width}: document overflow`);
      for (const panel of measurements.panels) {
        assert(panel.scroll === panel.client, `${variant} ${width}: panel overflow`);
        for (const b of panel.buttons) assert(b.name && b.width>=44 && b.height>=44, 'accessible button size/name');
      }
      const back = top.getByRole('button',{name:'Назад',exact:true});
      await back.focus();
      await page.keyboard.press('Tab');
      const save = top.getByRole('button',{name:'Сохранить',exact:true});
      assert(await save.evaluate(el=>el===document.activeElement && el.matches(':focus-visible') && getComputedStyle(el).outlineStyle!=='none'), 'visible keyboard focus');
      await page.keyboard.press('Enter');
      assert(await bottom.getByRole('button',{name:'Сохранено',exact:true}).getAttribute('aria-pressed')==='true','save sync down');
      await bottom.getByRole('button',{name:'Сохранено',exact:true}).click();
      assert(await top.getByRole('button',{name:'Сохранить',exact:true}).getAttribute('aria-pressed')==='false','save sync up');
      await top.getByRole('button',{name:'Изучено',exact:true}).click();
      assert(await bottom.getByRole('button',{name:'Изучено',exact:true}).getAttribute('aria-pressed')==='true','study sync down');
      await bottom.getByRole('button',{name:'Изучено',exact:true}).click();
      assert(await top.getByRole('button',{name:'Изучено',exact:true}).getAttribute('aria-pressed')==='false','study sync up');
      await top.getByRole('button',{name:'Поделиться',exact:true}).click();
      assert(await page.getByText('Демо: ссылка скопирована.',{exact:false}).isVisible(), 'share result');
      await bottom.getByRole('button',{name:'Поделиться',exact:true}).click();
      assert(await bottom.locator('..').getByRole('status').isVisible(),'bottom-local share feedback');
      await top.getByRole('button',{name:'Поделиться',exact:true}).click();
      await top.scrollIntoViewIfNeeded();
      await page.screenshot({path:`.reports/1591/${variant}-${width}-top.png`});
      await bottom.scrollIntoViewIfNeeded();
      await page.screenshot({path:`.reports/1591/${variant}-${width}-bottom.png`});
      await page.getByRole('checkbox',{name:'Есть следующий шаг'}).uncheck();
      assert(await top.getByRole('button',{name:'Дальше',exact:true}).count()===0 && await bottom.getByRole('button',{name:'Дальше',exact:true}).count()===0,'next absent');
      await back.click();
      assert(await page.getByText('Демо: возврат к программе курса.',{exact:false}).isVisible(),'back feedback');
      await page.emulateMedia({reducedMotion:'reduce'});
      assert(await top.getByRole('button',{name:'Изучено',exact:true}).evaluate(el=>getComputedStyle(el).animationName==='none' && getComputedStyle(el).transitionDuration==='0s'),'reduced motion');
      await page.addScriptTag({path:'apps/web/node_modules/axe-core/axe.min.js'});
      const axe = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-story-content]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})); });
      results.push({variant,width,measurements,axe});
      await page.emulateMedia({reducedMotion:'no-preference'});
    }
  }
  assert(writes.length===0,'unexpected API writes');
  return {results,writes};
}
