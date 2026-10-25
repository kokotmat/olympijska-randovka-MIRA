import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Reproduce navigation before the initial session request finishes. The older
// request must never replace the newer page with loading placeholders.
const nodes=new Map(),renders=[],requests=[];
const node=()=>({textContent:'',hidden:false,dataset:{},classList:{remove(){}},setAttribute(){},addEventListener(){}});
const location={hash:'#overview'};
const context=vm.createContext({document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},querySelectorAll(){return [];}},window:{addEventListener(){}},location,AbortSignal,console,setInterval(){},
 fetch:()=>new Promise(resolve=>requests.push(resolve)),renders});
const source=fs.readFileSync(new URL('../sprava/admin.js',import.meta.url),'utf8').replace("window.addEventListener('hashchange',()=>load());load();","window.addEventListener('hashchange',()=>load());");
vm.runInContext(source+`;renderOverview=async ticket=>renders.push(['overview',ticket]);renderOperations=async()=>{};renderMessages=async ticket=>renders.push(['messages',ticket]);`,context);
const initial=vm.runInContext('load()',context);
location.hash='#messages';
const newer=vm.runInContext('load()',context);
const session=()=>({ok:true,json:async()=>({status:'success',data:{user:{email:'offline@example.test',role:'admin'}}})});
requests[1](session());await newer;
requests[0](session());await initial;
assert.deepEqual(JSON.parse(JSON.stringify(renders)),[['messages',2]]);
assert.equal(nodes.get('page-title').textContent,'Zprávy a AI asistent');
console.log('PASS fast navigation during sign-in cannot repaint a newer admin page; no network or writes');
