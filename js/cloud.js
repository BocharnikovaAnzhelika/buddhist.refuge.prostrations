// Firebase-адаптер. Визуальные компоненты и аналитика не зависят от этой реализации.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,sendSignInLinkToEmail,isSignInWithEmailLink,signInWithEmailLink,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,getDoc,runTransaction} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {getState,applyState,setUser,readCache,readPreview,normalize} from './store.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
const overlay=$('authOverlay'),message=$('authMessage'),error=$('authError'),status=$('syncStatus');
let uid=null,ready=false,busy=false,dirty=false,timer=null,baseline={goal:111111,entries:[]};
const safeError=e=>{console.error(e);error.textContent=e?.message||String(e)};
function merge(remote,local,removed){const entries=new Map(remote.entries.map(e=>[e.id,e]));for(const id of removed)entries.delete(id);for(const e of local.entries)if(!removed.has(e.id))entries.set(e.id,e);return [...entries.values()]}
async function loadProfile(user){
 uid=user.uid;ready=false;setUser(uid);overlay.hidden=false;$('authForm').hidden=true;message.textContent='Загружаем историю практики…';error.textContent='';
 const ref=doc(db,'users',uid),snap=await getDoc(ref);let data=snap.exists()?normalize(snap.data()):null;
 const cache=readCache(uid),preview=readPreview();
 if(!data){
   // Импорт старой локальной версии — только после подтверждения.
   let initial={goal:111111,entries:[]};
   const source=(cache?.entries.length?cache:preview?.entries.length?preview:null);
   if(source&&confirm(`Найдено ${source.entries.length} локальных записей. Перенести их в новый облачный профиль?`))initial=source;
   await runTransaction(db,async tx=>{const existing=await tx.get(ref);if(!existing.exists())tx.set(ref,{...initial,deletedIds:[],displayName:sessionStorage.getItem('prostrations-name')||user.email?.split('@')[0]||'Практикующий',updatedAt:Date.now()})});
   data=normalize((await getDoc(ref)).data());
 }else if(cache?.entries.length){
   // Если на устройстве были несинхронизированные записи, не теряем их молча.
   const remoteIds=new Set(data.entries.map(e=>e.id));const missing=cache.entries.filter(e=>!remoteIds.has(e.id));
   if(missing.length&&confirm(`На устройстве есть ${missing.length} записей, отсутствующих в облаке. Добавить их?`)){
     await runTransaction(db,async tx=>{const snap=await tx.get(ref),raw=snap.data()||{},remote=normalize(raw),removed=new Set(raw.deletedIds||[]);tx.set(ref,{...raw,entries:merge(remote,cache,removed),updatedAt:Date.now()})});
     data=normalize((await getDoc(ref)).data());
   }
 }
 baseline=data;applyState(data);ready=true;overlay.hidden=true;$('account').hidden=false;
 const raw=(await getDoc(ref)).data()||{};
 $('userName').textContent=raw.displayName||sessionStorage.getItem('prostrations-name')||user.email?.split('@')[0]||'Практикующий';
 status.textContent='';
}
async function sync(){
 if(!ready||!uid)return;
 if(busy){dirty=true;return}
 busy=true;status.textContent='Сохраняем…';
 const local=getState(),old=baseline,removed=new Set(old.entries.filter(e=>!local.entries.some(x=>x.id===e.id)).map(e=>e.id));
 const changed=local.entries.filter(e=>{const before=old.entries.find(x=>x.id===e.id);return !before||before.count!==e.count||before.date!==e.date});
 const goalChanged=local.goal!==old.goal;
 try{
   const ref=doc(db,'users',uid);let result;
   await runTransaction(db,async tx=>{
     const snap=await tx.get(ref),raw=snap.data()||{},remote=normalize(raw),deleted=new Set([...(raw.deletedIds||[]),...removed]);
     // Не перезаписываем чужие изменения устаревшим локальным снимком.
     const entries=merge(remote,{entries:changed},deleted);
     result={goal:goalChanged?local.goal:remote.goal,entries};
     tx.set(ref,{...raw,...result,deletedIds:[...deleted],updatedAt:Date.now()});
   });
   baseline=result;
   // Если за время запроса пользователь сделал новые записи, не затираем их.
   if(!dirty)applyState(result);
   status.textContent='';
 }catch(e){console.error(e);status.textContent='⚠ Не удалось синхронизировать — изменения сохранены на устройстве';dirty=true}
 finally{busy=false;if(dirty&&navigator.onLine){dirty=false;clearTimeout(timer);timer=setTimeout(sync,2500)}}
}
window.addEventListener('practice:changed',()=>{if(!ready)return;clearTimeout(timer);timer=setTimeout(sync,700)});
window.addEventListener('online',()=>{if(ready)sync()});
$('authForm').addEventListener('submit',async e=>{
 e.preventDefault();error.textContent='';const email=$('authEmail').value.trim(),name=$('authName').value.trim();$('authSend').disabled=true;
 try{localStorage.setItem('prostrations-signin-email',email);sessionStorage.setItem('prostrations-name',name);await sendSignInLinkToEmail(auth,email,{url:location.origin+location.pathname,handleCodeInApp:true});message.textContent='Письмо отправлено. Открой ссылку, чтобы войти.'}
 catch(e){safeError(e)}finally{$('authSend').disabled=false}
});
$('logout').addEventListener('click',async()=>{if(!confirm('Выйти из профиля?'))return;ready=false;clearTimeout(timer);await signOut(auth);setUser(null);location.reload()});
try{if(isSignInWithEmailLink(auth,location.href)){
 let email=localStorage.getItem('prostrations-signin-email');if(!email)email=prompt('Введи почту, на которую пришла ссылка:');
 if(email){await signInWithEmailLink(auth,email,location.href);localStorage.removeItem('prostrations-signin-email');history.replaceState({},document.title,location.origin+location.pathname)}
}}catch(e){safeError(e)}
onAuthStateChanged(auth,async user=>{if(!user){ready=false;overlay.hidden=false;$('authForm').hidden=false;message.textContent='Войди по ссылке из письма, чтобы синхронизировать практику.';return}try{await loadProfile(user)}catch(e){safeError(e);message.textContent='Не удалось загрузить данные. Проверь сеть и правила Firestore.'}});
