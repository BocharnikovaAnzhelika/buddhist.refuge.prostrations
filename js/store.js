// Единственная точка изменения данных приложения. UI не знает о Firebase.
export const DEFAULT_GOAL=111111;
const PREVIEW_KEY='kagyu_preview_local_v1';
let current={goal:DEFAULT_GOAL,entries:[]};
let userId=null;
const listeners=new Set();
const clone=x=>JSON.parse(JSON.stringify(x));
export function normalize(s){return {goal:Number.isSafeInteger(s?.goal)&&s.goal>0?s.goal:DEFAULT_GOAL,entries:Array.isArray(s?.entries)?s.entries.filter(e=>e&&typeof e.id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&Number.isSafeInteger(e.count)&&e.count>0).map(e=>({id:e.id,date:e.date,count:e.count})):[]}}
export function getState(){return clone(current)}
export function onStateChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}
function emit(){for(const fn of listeners)fn(getState())}
function key(uid){return `kagyu_cloud_cache_${uid}`}
export function readPreview(){try{return normalize(JSON.parse(localStorage.getItem(PREVIEW_KEY)))}catch{return normalize(null)}}
export function readCache(uid){try{const raw=localStorage.getItem(key(uid));return raw?normalize(JSON.parse(raw)):null}catch{return null}}
export function applyState(data,{persist=true}={}){current=normalize(data);if(persist&&userId)localStorage.setItem(key(userId),JSON.stringify(current));emit()}
export function setUser(uid){userId=uid;if(!uid){current=normalize(null);emit()}}
export function updateState(data){if(!userId)throw Error('Войдите в профиль');applyState(data);window.dispatchEvent(new Event('practice:changed'))}
