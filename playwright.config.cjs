const {defineConfig} = require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/browser',timeout:30000,fullyParallel:true,retries:process.env.CI ? 1 : 0,
  workers:process.env.CI ? 2 : 1,
  reporter:process.env.CI ? [['github'],['html',{open:'never'}]] : 'list',
  use:{baseURL:'http://127.0.0.1:18761',trace:'retain-on-failure',screenshot:'only-on-failure',channel:process.env.PW_CHANNEL||undefined,launchOptions:{args:['--mute-audio']}},
  projects:[{name:'mobile',use:{viewport:{width:375,height:812}}},{name:'desktop',use:{viewport:{width:1280,height:800}}}],
  webServer:{command:'node tests/serve.cjs',url:'http://127.0.0.1:18761',reuseExistingServer:!process.env.CI}
});
