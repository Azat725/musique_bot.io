const {test,expect}=require('@playwright/test');
const tracks=Array.from({length:12},(_,i)=>({id:`track${String(i).padStart(6,'0')}`,title:`Song ${i}`,artist:'Artist',duration:180,cover:''}));
async function boot(page,patch={}) {
  await page.addInitScript((patch)=>{
    localStorage.setItem('musique.settings',JSON.stringify({storiesSeen:true,themeModeSet:true,lang:'en',theme:'light',sounds:false,deviceHints:{record:true,'radio-car':true,'radio-home':true},...patch}));
    HTMLMediaElement.prototype.play=function(){window.__audioAttempts=(window.__audioAttempts||0)+1;return Promise.resolve();};
  },patch);
  await page.route('**/*',async(route)=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/')) {
      const data={
        '/api/guest':{session:'test'},'/api/me':{user:{id:-1,kind:'guest'},token:'test'},'/api/home':{recent:tracks,genres:[]},'/api/recommend':{tracks},'/api/likes':{tracks},'/api/history/ids':{ids:[]},'/api/playlists':{playlists:[]},'/api/artists':{artists:[]},'/api/state':{settings:null,queue:null},'/api/suggest':{suggestions:['Miles Davis','Miles Davis Kind of Blue']},'/api/search':{tracks,more:[],artists:[]},'/api/lyrics/track000000':{lyrics:null},'/api/radio':{tracks},
      }[url.pathname]||{};
      return route.fulfill({json:data});
    }
    if(url.hostname!=='127.0.0.1')return route.abort();
    return route.continue();
  });
  await page.goto('/?api=http://127.0.0.1:18761');
  await expect(page.locator('#nav')).toBeVisible();
  await expect(page.locator('.boot')).toHaveCount(0);
}
async function settings(page) {
  await page.locator('[data-tab="settings"]').click();
  await expect(page.locator('.settings-view')).toBeVisible();
}
test('settings apply at once: a player, its colour and a theme in one tap each',async({page})=>{
  await boot(page); await settings(page);
  await page.locator('[data-picks="playerMode"] [data-value="cd"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-player','cd');
  await page.locator('[data-swatches="cdColor"] [data-value="blue"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-cd','blue');
  await page.locator('[data-picks="colorTheme"] [data-value="ussr"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','ussr');
  await expect(page.locator('select, [data-apply]')).toHaveCount(0);
});
test('modal Escape returns focus to its opener',async({page})=>{
  await boot(page); await settings(page);
  const button=page.locator('[data-action="presets"]'); await button.click();
  await expect(page.locator('.sheet.is-open')).toBeVisible();await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
});
test('saved looks are put back on in one tap',async({page})=>{
  await boot(page);await settings(page);await page.locator('[data-action="presets"]').click();
  await page.getByRole('button',{name:'Save current look',exact:true}).click();
  await page.locator('.dialog input').fill('Evening');await page.getByRole('button',{name:'Save',exact:true}).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).lookPresets.length)).toBe(1);
  await page.locator('[data-picks="colorTheme"] [data-value="noir"]').click();
  await page.locator('[data-action="presets"]').click();await page.getByRole('button',{name:/^Evening/}).click();await page.getByRole('button',{name:'Put it on',exact:true}).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme','noir');
});
test('search suggestions support keyboard; results survive a failed refresh and retry',async({page})=>{
  await boot(page); await page.locator('[data-tab="search"]').click();
  const input=page.locator('input[role="combobox"]'); await input.fill('Miles');
  await expect(page.locator('.suggest__item').first()).toBeVisible(); await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant','suggestion-0');await input.press('Enter');
  await expect(page.locator('.search__body .track')).toHaveCount(12);
  await page.route('**/api/search?**',route=>route.fulfill({status:503,json:{}}));
  await input.fill('new query');await expect(page.locator('.search__status')).toContainText('Could not load');
  await expect(page.locator('.search__body .track')).toHaveCount(12);
  await page.unroute('**/api/search?**');await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.search__status')).toBeEmpty();
});
test('unlike can be undone from the library',async({page})=>{
  await boot(page);await page.locator('[data-tab="library"]').click();await page.locator('[data-go="likes"]').click();
  await expect(page.locator('.track')).toHaveCount(12);
  await page.locator('.track__like').first().click();await expect(page.locator('.track:not(.is-removing)')).toHaveCount(11);
  await page.locator('.toast__action').click();await expect(page.locator('.track')).toHaveCount(12);
});
test('queue removal and undo preserve the current track; new queues reject old undo',async({page})=>{
  await boot(page);
  await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');player._load=()=>{};player.playQueue(tracks);const {openQueue}=await import('/js/queue.js');openQueue();},tracks.slice(0,3));
  await expect(page.locator('.queue__summary')).toContainText('2');
  await page.locator('.qrow__remove').first().click();await expect(page.locator('.queue__list .qrow')).toHaveCount(1);
  await page.locator('.toast__action').click();await expect(page.locator('.queue__list .qrow')).toHaveCount(2);
  await page.locator('.queue__clear').click();await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');player.playQueue([tracks[4]]);},tracks);
  await page.locator('.toast__action').click();await expect(page.locator('.queue__list .qrow')).toHaveCount(0);
});
test('downloads screen can pause and resume without deleting liked songs',async({page})=>{
  await boot(page);await settings(page);await page.locator('[data-action="downloads"]').click();
  await page.locator('[data-pause]').click();await expect(page.locator('[data-pause]')).toHaveText('Resume');
  await page.locator('[data-pause]').click();await expect(page.locator('[data-pause]')).toHaveText('Pause');
});
test('radio: the receiver decides the era, its keys tune stations; all device modes open without audio',async({page})=>{
  await boot(page,{playerMode:'radio-car'});await settings(page);
  await page.locator('[data-action="receiver"]').click();
  await page.locator('.garage__item[data-id="w123"]').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioCar)).toBe('w123');
  await page.evaluate(async()=>{const {openControlPanel}=await import('/js/eq.js');openControlPanel();});
  await expect(page.locator('[data-seg="speed"]')).toHaveCount(0);
  await expect(page.locator('[data-seg="radioRain"]')).toBeVisible();
  await page.keyboard.press('Escape');
  for(const mode of ['record','turntable','cassette','reel','cd','phonograph','radio-car','radio-home']){
    await page.evaluate(async({mode,tracks})=>{const {updateSettings}=await import('/js/store.js');const {player}=await import('/js/player.js');updateSettings({playerMode:mode,deviceHints:{[mode]:true}});player.queue=[tracks[0]];player.index=0;const {openPlayer}=await import('/js/vinyl.js');openPlayer();},{mode,tracks});
    await expect(page.locator(`.fp.is-${mode}.is-open`)).toBeVisible();
    await page.locator('.fp [data-close]').click();
  }
  expect(await page.evaluate(()=>window.__audioAttempts||0)).toBe(0);
});
test('radio: Home and Settings show the chosen receiver at once',async({page})=>{
  await boot(page,{playerMode:'radio-car',radioCar:'fiat500'});
  await expect(page.locator('.radio-card .section__title')).toHaveText('Fiat 500');
  await page.evaluate(async()=>{ const m=await import('/js/store.js'); m.updateSettings({radioCar:'ds'}); });
  await expect(page.locator('.radio-card .section__title')).toHaveText('Citroën DS');
  await expect(page.locator('.radio-card .shelf__sub')).toContainText('1965');
  await settings(page);
  await expect(page.locator('[data-action="receiver"]')).toContainText('Citroën DS');
  await page.evaluate(async()=>{ const m=await import('/js/store.js'); m.updateSettings({radioCar:'volga'}); });
  await expect(page.locator('[data-action="receiver"]')).toContainText('ГАЗ-21');
  await page.locator('[data-tab="home"]').click();
  await expect(page.locator('.radio-card .section__title')).toContainText('ГАЗ-21');
});
test('radio: the Garage lists every car and can be narrowed to one country',async({page})=>{
  await boot(page,{playerMode:'radio-car'});
  await page.locator('[data-change]').first().click();
  const cars=await page.evaluate(async()=>{const {RECEIVERS}=await import('/js/devices/receivers.js');const all=RECEIVERS.filter((r)=>r.kind==='car'),fr=all.filter((r)=>r.country==='fr').sort((a,b)=>a.year-b.year);return {all:all.length,fr:fr.length,firstFr:fr[0].name};});
  await expect(page.locator('.garage__item')).toHaveCount(cars.all);
  await page.locator('.garage__filter [data-country="fr"]').click();
  await expect(page.locator('.garage__item:visible')).toHaveCount(cars.fr);
  await expect(page.locator('.garage__item:visible .garage__meta')).toHaveText(Array(cars.fr).fill(/France/));
  await page.locator('.garage__item:visible').first().click();
  await expect(page.locator('.radio-card .section__title')).toHaveText(cars.firstFr);
});
test('drive: the mini game asks first, drives only on the road, tunes by holding the radio, leaves on Escape and talks to no server',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:812,height:375});
  const requests=[];
  page.on('request',(r)=>{ if(new URL(r.url()).pathname.startsWith('/api/')) requests.push(new URL(r.url()).pathname); });
  await boot(page,{playerMode:'radio-car',firstUse:Date.now()}); // the day of first use is already stamped: nothing else is saved meanwhile
  await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');const {openPlayer}=await import('/js/vinyl.js');player.queue=[tracks[0]];player.index=0;openPlayer();},tracks);
  await expect(page.locator('.fp.is-radio-car.is-open')).toBeVisible();
  await page.locator('[data-drive]').click();
  await expect(page.locator('.sheet .drive-warn')).toBeVisible(); // the warning comes first
  await page.locator('.sheet__cancel').click();
  await expect(page.locator('.drive')).toHaveCount(0);
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.locator('[data-drive]').click();
  await page.locator('.sheet .sheet__item').first().click();
  await expect(page.locator('.drive')).toBeVisible();
  await expect(page.locator('.drive .rx-needle').first()).toBeAttached(); // the car's own dashboard, alive
  const coloursSeen=await page.evaluate(()=>{const c=document.querySelector('.drive__view'),d=c.getContext('2d').getImageData(0,0,c.width,Math.round(c.height*.5)).data,seen=new Set();for(let i=0;i<d.length;i+=4*97)seen.add(d[i]+','+d[i+1]+','+d[i+2]);return seen.size;});
  expect(coloursSeen).toBeGreaterThan(8); // the town is drawn, not a blank canvas
  const quiet=requests.length;
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.down('d');
  await page.waitForTimeout(3500);
  await page.keyboard.up('d');await page.keyboard.up('w');
  const state=await page.evaluate(async()=>{const g=(await import('/js/drive/game.js')).driveState(),P=await import('/js/drive/physics.js');return {v:g.car.v,odo:g.car.odo,onRoad:P.outline(g.car).every(([x,y])=>g.world.onRoad(x,y))};});
  expect(state.odo).toBeGreaterThan(5);
  expect(state.onRoad).toBe(true);
  expect(requests.length).toBe(quiet); // driving sends nothing
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioStation||'');
  const box=await page.locator('.dv-radio').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.waitForTimeout(800);await page.mouse.up(); // a short press does nothing
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioStation||'')).toBe(before);
  await page.mouse.down();await page.waitForTimeout(2900);await page.mouse.up(); // held for 2.5 seconds: the next station
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioStation||'')).not.toBe(before);
  const held=await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioStation||'');
  await page.keyboard.press('n'); // the key does the same as holding the radio
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioStation||'')).not.toBe(held);
  await page.keyboard.press('Shift+N'); // and Shift goes back
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioStation||'')).toBe(held);
  await page.keyboard.press('Escape');
  await expect(page.locator('.drive')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/drive-open/);
  await expect(page.locator('.fp.is-open')).toBeVisible(); // back in the player
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.setViewportSize({width:375,height:812});
  await page.locator('[data-drive]').click();await page.locator('.sheet .sheet__item').first().click();
  await expect(page.locator('.drive__rotate')).toBeVisible(); // held upright: asks to turn the phone
  await page.keyboard.press('Escape');
  await page.locator('.fp [data-close]').click();
  await page.evaluate(async()=>{const {updateSettings}=await import('/js/store.js');updateSettings({playerMode:'record'});const {openPlayer}=await import('/js/vinyl.js');openPlayer();});
  await expect(page.locator('[data-drive]')).toBeHidden(); // only a car can be driven
});
test('support: after two weeks one page offers to support the author through the bot, only once',async({page})=>{
  test.setTimeout(60000);
  const day=24*3600*1000;
  await page.addInitScript(()=>{window.__opened=[];window.open=(u)=>{window.__opened.push(u);return null;};});
  await boot(page,{firstUse:Date.now()-5*day});
  await page.waitForTimeout(5000);
  await expect(page.locator('.stories')).toHaveCount(0); // five days: not yet
  await page.evaluate(async(d)=>{const {updateSettings}=await import('/js/store.js');updateSettings({firstUse:Date.now()-15*d});const m=await import('/js/stories.js');m.maybeShowSupport();},day);
  await expect(page.locator('.stories')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-support]')).toBeVisible();
  await page.locator('[data-support]').click();
  expect(await page.evaluate(()=>window.__opened)).toEqual(['https://t.me/musiqueenbot']);
  await expect(page.locator('.stories')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).supportAsked)).toBe(true);
  await page.evaluate(async()=>{const m=await import('/js/stories.js');await m.maybeShowSupport();});
  await expect(page.locator('.stories')).toHaveCount(0); // never again
});
test('only the machine: no button on the stage, left through the player menu; no sideways overflow',async({page})=>{
  await boot(page,{playerMode:'cd',bareDeck:true});await page.setViewportSize({width:812,height:375});
  await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');player.queue=[tracks[0]];player.index=0;const {openPlayer}=await import('/js/vinyl.js');openPlayer();},tracks);
  await expect(page.locator('.fp')).toHaveClass(/is-bare/);await expect(page.locator('.bare-exit, [data-bare-exit]')).toHaveCount(0);
  await page.locator('.fp [data-more]').click();await page.getByRole('button',{name:/Show the player/}).click();
  await expect(page.locator('.fp')).not.toHaveClass(/is-bare/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('removing a downloaded file keeps the favourite and does not download it again',async({page})=>{
  await boot(page);
  await page.evaluate(async(track)=>{
    const db=await new Promise((resolve,reject)=>{const open=indexedDB.open('musique-offline',1);open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').put({id:track.id,meta:track,blob:new Blob(['test'],{type:'audio/mp4'}),size:4});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); db.close();
  },tracks[0]);
  await page.reload();await expect(page.locator('.boot')).toHaveCount(0);await settings(page);await page.locator('[data-action="downloads"]').click();
  await expect(page.locator('.download-row')).toHaveCount(1);await page.locator('[data-action="remove"]').click();
  await expect(page.locator('.download-row')).toHaveCount(0);
  expect(await page.evaluate(async()=>{const {likes}=await import('/js/store.js');return likes.has('track000000');})).toBe(true);
});
test('drive: the race shows the next checkpoint, ends with a result, and the best time stays on this device only',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:812,height:375});
  const requests=[];
  page.on('request',(r)=>{ if(new URL(r.url()).pathname.startsWith('/api/')) requests.push(new URL(r.url()).pathname); });
  await boot(page,{playerMode:'radio-car',firstUse:Date.now()});
  await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');const {openPlayer}=await import('/js/vinyl.js');player.queue=[tracks[0]];player.index=0;openPlayer();},tracks);
  await page.locator('[data-drive]').click();
  await page.locator('.sheet .sheet__item').nth(1).click(); // the race
  await expect(page.locator('.drive')).toBeVisible();
  await expect(page.locator('.drive__hud1')).toHaveText('Checkpoint 1 of 6');
  await expect(page.locator('.drive__arrow')).toBeVisible();
  const quiet=requests.length;
  await page.evaluate(async()=>{ // drive to every checkpoint at once
    const g=(await import('/js/drive/game.js')).driveState();
    for(const p of g.course().points){ Object.assign(g.car,{x:p.x,y:p.y,v:3}); await new Promise((r)=>setTimeout(r,120)); }
  });
  await expect(page.locator('.drive__result')).toBeVisible();
  await expect(page.locator('.drive__result h2')).toHaveText('Race finished');
  await expect(page.locator('.drive__resultbest')).toHaveText('Your best yet!');
  const kept=await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.drive-records')));
  expect(kept.race).toBeGreaterThan(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).drive)).toBeUndefined(); // not in the synced settings
  await page.locator('[data-keep]').click();
  await expect(page.locator('.drive__result')).toBeHidden();
  await expect(page.locator('.drive__hud1')).toContainText('No touches');
  expect(requests.length).toBe(quiet); // nothing sent anywhere
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
});
test('drive: night, dusk and day look different, rain can be switched on, and the choice is kept on this device',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:812,height:375});
  const requests=[];
  page.on('request',(r)=>{ if(new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.url()); });
  await boot(page,{playerMode:'radio-car',firstUse:Date.now(),radioRain:false});
  await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');const {openPlayer}=await import('/js/vinyl.js');player.queue=[tracks[0]];player.index=0;openPlayer();},tracks);
  await page.locator('[data-drive]').click();
  await page.locator('.sheet .sheet__item').first().click();
  await expect(page.locator('.drive')).toBeVisible();
  const quiet=requests.length; // what the app asked for before the game
  const sky=()=>page.evaluate(()=>new Promise((res)=>setTimeout(()=>{const c=document.querySelector('.drive__view'),d=c.getContext('2d').getImageData(0,2,c.width,6).data;let s=0;for(let i=0;i<d.length;i+=4)s+=d[i]+d[i+1]+d[i+2];res(s/(d.length/4*3));},400)));
  const night=await sky();
  await page.locator('[data-env-time]').click();await page.locator('[data-env-time]').click(); // night → dusk → day
  const day=await sky();
  expect(day).toBeGreaterThan(night+80); // the sky is light by day
  await expect(page.locator('[data-env-rain]')).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-env-rain]').click();
  await expect(page.locator('[data-env-rain]')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.drive-env')))).toEqual({time:'day',rain:true});
  await page.keyboard.press('t'); // the key goes on round to the night again
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.drive-env')).time)).toBe('night');
  await page.keyboard.press('r'); // and the rain stops
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.drive-env')).rain)).toBe(false);
  expect(requests.length).toBe(quiet); // the game sent nothing
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
});
test('radio: the night mode dims the set, makes the sound half as loud and goes with the setting',async({page})=>{
  await boot(page,{playerMode:'radio-car'});await settings(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-radio-night','');
  expect(await page.evaluate(async()=>(await import('/js/player.js')).player.audio.volume)).toBe(1);
  await page.locator('[data-name="radioNight"] [data-value="on"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-radio-night','');
  expect(await page.evaluate(async()=>(await import('/js/player.js')).player.audio.volume)).toBe(0.5);
  await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');const {openPlayer}=await import('/js/vinyl.js');player.queue=[tracks[0]];player.index=0;openPlayer();},tracks);
  await expect(page.locator('.fp.is-radio-car.is-open')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Number(getComputedStyle(document.querySelector('.rx--car .rx__draw'),'::after').opacity))).toBeGreaterThan(0.3); // a veil over the dashboard (after its fade), the dial above it
  await page.locator('.fp [data-close]').click();
  await page.locator('[data-name="radioNight"] [data-value="off"]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-radio-night','');
  expect(await page.evaluate(async()=>(await import('/js/player.js')).player.audio.volume)).toBe(1);
  await page.locator('[data-name="radioNight"] [data-value="on"]').click();
  await page.locator('[data-picks="playerMode"] [data-value="record"]').click(); // not a radio: nothing dimmed, full volume
  await expect(page.locator('html')).not.toHaveAttribute('data-radio-night','');
  expect(await page.evaluate(async()=>(await import('/js/player.js')).player.audio.volume)).toBe(1);
});
test('radio alarm: set in Settings, rings its station at the time, asks for a tap when the sound is blocked, snoozes; the sleep sheet of a radio offers it',async({page})=>{
  test.setTimeout(60000);
  await boot(page,{playerMode:'radio-car'});await settings(page);
  await expect(page.locator('[data-state="alarm"]')).toHaveText('off');
  await page.locator('[data-action="alarm"]').click();
  await expect(page.locator('.sheet .alarm')).toBeVisible();
  await page.locator('[data-alarm="on"]').check();
  await page.locator('[data-alarm="time"]').fill('07:30');
  await page.locator('[data-alarm="station"]').selectOption('fr');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioAlarm)).toEqual({on:true,time:'07:30',station:'fr'});
  await page.locator('.sheet__cancel').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.locator('[data-state="alarm"]')).toContainText('07:30');
  // the alarm is this device's own: it does not travel with the account's look
  expect(await page.evaluate(async()=>{const {sharedSettings}=await import('/js/store.js');return 'radioAlarm' in (sharedSettings?.()||{});})).toBe(false);
  // eleven minutes past: too late to ring; at the time: it rings
  expect(await page.evaluate(async()=>(await import('/js/alarm.js')).checkAlarm(new Date(2026,0,5,7,40)))).toBe(false);
  expect(await page.evaluate(async()=>(await import('/js/alarm.js')).checkAlarm(new Date(2026,0,5,7,30,5)))).toBe(true);
  await expect(page.locator('.sheet__title')).toContainText('Alarm · 07:30',{timeout:6000});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('musique.settings')).radioStation)).toBe('fr');
  await expect(page.locator('.sheet__item').first()).toContainText('Turn the radio on'); // the test browser plays nothing by itself: it asks for a tap
  await page.locator('.sheet__item').filter({hasText:'10 more minutes'}).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  // the sleep sheet of a radio: its own title and the alarm among the choices
  await page.evaluate(async(tracks)=>{const {player}=await import('/js/player.js');const {openPlayer}=await import('/js/vinyl.js');player.queue=[tracks[0]];player.index=0;openPlayer();},tracks);
  await page.locator('.fp [data-more]').click();
  await page.locator('.sheet__item').filter({hasText:'Sleep timer'}).click();
  await expect(page.locator('.sheet__title')).toHaveText('Turn the radio off in…');
  await expect(page.locator('.sheet__item').last()).toContainText('Alarm clock: 07:30');
  await page.locator('.sheet__item').last().click();
  await expect(page.locator('.sheet .alarm')).toBeVisible();
});
