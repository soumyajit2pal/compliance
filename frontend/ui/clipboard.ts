/** Shared clipboard action; callers must report failures instead of claiming a successful copy. */
export async function copyText(value:string) {
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);return;}catch{/* Older/permission-restricted browsers use the selection fallback. */}}
  const active=document.activeElement as HTMLElement,field=document.createElement('textarea');
  field.value=value;field.readOnly=true;field.style.cssText='position:fixed;opacity:0;left:0;top:0';document.body.append(field);
  try{field.select();if(typeof document.execCommand!=='function'||!document.execCommand('copy'))throw new Error('Copy was blocked. Select the reference and copy it manually.');}
  finally{field.remove();active?.focus();}
}
