// Firebase-адаптер. Визуальные компоненты и аналитика не зависят от этой реализации.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,sendSignInLinkToEmail,isSignInWithEmailLink,signInWithEmailLink,signOut,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,getDoc,runTransaction} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {getState,applyState,setUser,readCache,readPreview,normalize} from './store.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
const overlay=$('authOverlay'),message=$('authMessage'),error=$('authError'),status=$('syncStatus');
let uid=null,ready=false,busy=false,dirty=false,timer=null,authResolving=true,baseline={goal:111111,entries:[]};
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
// Авторизация: PWA на iOS может открывать email-ссылку в отдельной вкладке Chrome.
// Поэтому сохраняем сессию явно и разрешаем вставить ссылку прямо в установленном приложении.
const manualPanel=$('manualPanel'),manualToggle=$('manualToggle');
manualToggle.addEventListener('click',()=>{manualPanel.hidden=!manualPanel.hidden;manualToggle.setAttribute('aria-expanded',String(!manualPanel.hidden))});
function rememberEmail(email){localStorage.setItem('prostrations-signin-email',email)}
function restoreEmail(){return localStorage.getItem('prostrations-signin-email')||''}
function cleanAuthUrl(){history.replaceState({},document.title,location.pathname+location.search.replace(/([?&])(?:apiKey|oobCode|mode|continueUrl|lang)=[^&]*/g,'$1').replace(/[?&]$/,''))}
async function completeEmailSignIn(link,email){
 if(!isSignInWithEmailLink(auth,link))throw new Error('Это не ссылка для входа Firebase. Скопируй полную ссылку из письма.');
 if(!email)throw new Error('Укажи почту, на которую пришло письмо.');
 message.textContent='Проверяем ссылку и восстанавливаем профиль…';error.textContent='';
 await signInWithEmailLink(auth,email.trim(),link);
 localStorage.removeItem('prostrations-signin-email');
 if(isSignInWithEmailLink(auth,location.href))cleanAuthUrl();
}
$('manualPanel').addEventListener('submit',async e=>{
 e.preventDefault();error.textContent='';const button=$('manualSubmit');button.disabled=true;
 try{await completeEmailSignIn($('manualLink').value.trim(),$('manualEmail').value.trim())}
 catch(err){safeError(err);message.textContent='Не удалось войти. Проверь ссылку и адрес почты.'}
 finally{button.disabled=false}
});
$('authForm').addEventListener('submit',async e=>{
 e.preventDefault();error.textContent='';const email=$('authEmail').value.trim(),name=$('authName').value.trim();$('authSend').disabled=true;
 try{rememberEmail(email);$('manualEmail').value=email;sessionStorage.setItem('prostrations-name',name);await sendSignInLinkToEmail(auth,email,{url:location.origin+location.pathname,handleCodeInApp:true});message.textContent='Письмо отправлено. Если ссылка откроется в Chrome, скопируй её и вставь ниже в установленном приложении.'}
 catch(err){safeError(err)}finally{$('authSend').disabled=false}
});
$('logout').addEventListener('click',async()=>{if(!confirm('Выйти из профиля?'))return;ready=false;clearTimeout(timer);await signOut(auth);setUser(null);location.reload()});
// Не показываем форму входа, пока Firebase не проверит сохранённую сессию.
overlay.hidden=false;$('authForm').hidden=true;message.textContent='Проверяем вход…';
$('manualEmail').value=restoreEmail();
try{
 await setPersistence(auth,browserLocalPersistence);
 if(isSignInWithEmailLink(auth,location.href)){
   let email=restoreEmail();
   if(!email)email=prompt('Введи почту, на которую пришла ссылка:')||'';
   if(email)await completeEmailSignIn(location.href,email);
   else message.textContent='Укажи почту и вставь ссылку ниже, чтобы завершить вход.';
 }
}catch(err){safeError(err);message.textContent='Не удалось завершить вход. Можно вставить ссылку вручную ниже.'}
onAuthStateChanged(auth,async user=>{
 authResolving=false;
 if(!user){ready=false;overlay.hidden=false;$('authForm').hidden=false;message.textContent='Войди по ссылке из письма, чтобы синхронизировать практику. На iPhone ссылку можно вставить ниже.';return}
 try{await loadProfile(user)}catch(err){safeError(err);overlay.hidden=false;$('authForm').hidden=false;message.textContent='Не удалось загрузить данные. Проверь сеть и правила Firestore.'}
});
