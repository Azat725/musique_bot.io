const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('failed optimistic likes roll back local state and successful likes can be undone',async()=>{
  let fail=true;
  const api={like:async()=>{if(fail)throw Error('offline');},unlike:async()=>{}};
  const context=vm.createContext({window:{},navigator:{language:'en'},localStorage:{getItem:()=>null,setItem:()=>{}},document:new EventTarget(),CustomEvent,setTimeout,clearTimeout,console});
  const mock=(obj)=>new vm.SyntheticModule(Object.keys(obj),function(){Object.entries(obj).forEach(([k,v])=>this.setExport(k,v));},{context});
  const deps={'./api.js':mock({api}),'./themes.js':mock({NATIVE_MODE:{}})};
  const mod=new vm.SourceTextModule(fs.readFileSync('docs/js/store.js','utf8'),{context});await mod.link(s=>deps[s]);await mod.evaluate();
  const {setLike,likes}=mod.namespace,tr={id:'a',title:'A'};await assert.rejects(setLike(tr,true));assert.equal(likes.has('a'),false);fail=false;await setLike(tr,true);assert.equal(likes.has('a'),true);await setLike(tr,false);assert.equal(likes.has('a'),false);
});
test('view disposal removes global subscriptions',async()=>{
  const source=fs.readFileSync('docs/js/lifecycle.js','utf8');const mod=await import('data:text/javascript,'+encodeURIComponent(source));
  const root={},target=new EventTarget();let count=0,cleaned=0;const scope=mod.viewScope(root);scope.listen(target,'tick',()=>count++);scope.keep(()=>cleaned++);target.dispatchEvent(new Event('tick'));root.dispose();root.dispose();target.dispatchEvent(new Event('tick'));assert.equal(count,1);assert.equal(cleaned,1);
});
