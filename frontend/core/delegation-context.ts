/** A per-tab selection, never an authentication credential or an access grant. */
const key='cbd-leave-cover';
export function selectedDelegationId(){try{return sessionStorage.getItem(key)||'';}catch{return '';}}
export function selectDelegation(id:string){try{if(id)sessionStorage.setItem(key,id);else sessionStorage.removeItem(key);}catch{}}
export function delegationHeaders(path:string){
 const id=selectedDelegationId();
 return id&&(!path.startsWith('/auth/')||path==='/auth/me')&&!path.startsWith('/delegations')?{'X-Delegation-ID':id}:{};
}
