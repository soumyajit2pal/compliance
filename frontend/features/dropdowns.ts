import {editButton} from './masters.ts';
import {api} from '../core/api.ts';
import {state} from '../core/state.ts';
import {area,button,esc,field,input,link,message,select,title} from '../ui/components.ts';
import {close,modal} from '../ui/dialog.ts';
import {heading} from '../ui/layout.ts';
import {searchForm,table,tablePanel,tabs,detailFields} from '../ui/widgets.ts';

const cat=()=>state.view.dropdownCatalogue;
const rows=(map:Record<string,string>)=>Object.entries(map).map(([id,name])=>({id,name}));
const check=(name,label,checked)=>'<label class="check-label"><input type="checkbox" name="'+esc(name)+'" '+(checked?'checked':'')+'> '+esc(label)+'</label>';
const edit=(kind,key,label='Edit')=>button('dropdown-edit',label,'data-kind="'+kind+'" data-key="'+esc(key)+'"','small');
function optionPath(key:string) {
  return 'dropdowns?options='+encodeURIComponent(key);
}

async function businessOptions(key, definition, query, request) {
  const [masters, catalogue] = await Promise.all([api('/masters'), api('/masters/catalogue')]);
  if (request !== state.routeNumber || !state.identity) return '';
  state.masters = masters;
  state.view.masterCatalogue = catalogue;
  const source = definition.source;
  const term = (query.get('q') || '').trim().toLowerCase();
  const options = masters[source].filter(row => [row.code,row.name].some(text => text.toLowerCase().includes(term)))
    .sort((a,b) => (a.display_sequence || 0) - (b.display_sequence || 0) || a.name.localeCompare(b.name));
  const add = button('add-master','Add option','data-key="'+esc(source)+'"','primary');
  return link('dropdowns','Back to business dropdowns','back-link') +
    heading(definition.label,definition.forms.join(' · '),add) +
    searchForm('view-filter','Search options by name or code…',query.get('q')||'',
      '<input type="hidden" name="options" value="'+esc(key)+'">') +
    tablePanel(table(['Option','Permanent code','Status',''], options.map(row=>[
      esc(row.name),esc(row.code),row.active_flag?'Active':'Retired',editButton(source,row,'Edit option')
    ]),{empty:'No matching options'}));
}

function directoryRows(c, fields, matches) {
  const records = Object.entries<any>(c.business_fields).map(([key,definition]) => ({
    key, label:definition.label, form:definition.forms.join(', '),
    type:definition.source?'Editable options':'Fixed choices',
    actions:(definition.source ? link(optionPath(key),'Manage options','btn small')+' ' : '')+
      edit('presentation',key,'Configure'),
  }));
  for (const [key,definition] of fields) {
    if (definition.active) records.push({
      key,label:definition.label, form:c.forms[definition.form], type:'Custom field',
      actions:edit('lists',definition.source,'Manage options')+' '+edit('fields',key,'Edit field'),
    });
  }
  return records.filter(r=>matches(r.key,r.label,r.form)).sort((a,b)=>a.label.localeCompare(b.label))
    .map(r=>[esc(r.label),esc(r.form),esc(r.type),r.actions]);
}
export async function dropdownsPage(_id,query) {
  const request=state.routeNumber,c=await api('/admin/dropdowns');
  if(request!==state.routeNumber || !state.identity)return '';
  state.view.dropdownCatalogue=c;
  const optionsKey=query.get('options');
  if(optionsKey && Object.hasOwn(c.business_fields,optionsKey) && c.business_fields[optionsKey].source)
    return businessOptions(optionsKey,c.business_fields[optionsKey],query,request);
  const tab=query.get('tab')||'directory',q=(query.get('q')||'').trim().toLowerCase();
  const matches=(...terms)=>terms.flat().join(' ').toLowerCase().includes(q);
  const listKeys=Object.keys(c.lists),fields=Object.entries<any>(c.fields);
  const nav=tabs([['directory','Business dropdowns',Object.keys(c.business_fields).length+fields.filter(([,f])=>f.active).length],['lists','Choice lists',listKeys.length],['fields','Form fields',fields.length],['history','Publish history']],tab,'dropdowns',query);
  const search=searchForm('view-filter','Search '+(tab==='fields'?'fields and forms':tab==='lists'?'choice lists':'dropdowns and screens')+'…',q,'<input type="hidden" name="tab" value="'+esc(tab)+'">');
  let body,action='';
  if(tab==='history') {
    body=table(['Revision','Change','Published by','When','Reason'],(c.recent||[]).map(e=>[esc(e.revision),esc(e.label),esc(e.actor_name),esc(e.event_at.replace('T',' ')+' UTC'),esc(e.reason)]),{empty:'No changes published',caption:'Latest 30 published changes'});
  } else if(tab==='lists') {
    action=edit('lists','','Add choice list');
    body=table(['Choice list','Active options','Used by',''],listKeys.filter(k=>matches(k,c.lists[k].label)).map(k=>[esc(c.lists[k].label),String(c.lists[k].options.filter(o=>o.active).length),esc(fields.filter(([,v])=>v.source===k).map(([,v])=>v.label).join(', ')||'No fields yet'),edit('lists',k)]),{empty:'No matching choice lists'});
  } else if(tab==='fields') {
    action=listKeys.length?edit('fields','','Add dropdown field'):link('dropdowns?tab=lists','Create a choice list first','btn');
    body=table(['Field','Form','Choice list','Entry',''],fields.filter(([k,f])=>matches(k,f.label,c.forms[f.form])).map(([k,f])=>[esc(f.label),esc(c.forms[f.form]),esc(c.lists[f.source].label),f.active?(f.required?'Required':'Optional'):'Retired',edit('fields',k)]),{empty:'No matching form fields'});
  } else {
    body=table(['Business field','Form','Options',''], directoryRows(c,fields,matches),{empty:'No matching business fields'});
  }
  return heading('Dropdowns','Published configuration · Revision '+c.revision,action)+nav+(tab==='history'?'':search)+tablePanel(body);
}
function optionRow(o={code:'',label:'',active:true},existing=false){
  return '<div data-choice-row class="dropdown-option-row">'+field('Code',input('option_code',o.code,'text','required maxlength="40" pattern="[A-Z0-9][A-Z0-9_/\\-]*" '+(existing?'readonly':'')))+
    field('Display label',input('option_label',o.label,'text','required maxlength="160"'))+check('option_active','Active',o.active)+
    button('dropdown-move','Move up','','small')+(!existing?button('dropdown-remove','Remove','','small'):'')+'</div>';
}
function editor(kind,key,initial?,reason='') {
  const c=cat(),existing=Object.hasOwn(c[kind],key)?c[kind][key]:null,v=initial||existing||{};
  const permanent=field('Permanent key',input('config_key',key,'text',(existing?'readonly ':'')+'required pattern="[a-z][a-z0-9_]{0,39}" maxlength="40"'),'Use lowercase letters, numbers and underscores.');
  const name=field('Display label',input('config_label',v.label,'text','required maxlength="160"'));
  let body='';
  if(kind==='lists') body=permanent+name+'<div class="full"><h3>Options in display order</h3><div data-choice-rows>'+ (v.options||[undefined]).map(o=>optionRow(o,existing?.options.some(x=>x.code===o?.code))).join('')+'</div>'+button('dropdown-add-option','Add option')+'</div>';
  if(kind==='fields'){
    body=permanent+name+field('Form',select('designer_form',rows(c.forms),v.form,'name',existing?'disabled':'required'))+
      field('Choice list',select('designer_list',rows(Object.fromEntries(Object.entries<any>(c.lists).map(([id,l])=>[id,l.label]))),v.source,'name',existing?'disabled':'required'))+
      check('field_required','Required on entry',v.required)+check('field_active','Show on form',v.active??true);
  }
  if(kind==='presentation'){
    const definition=c.business_fields[key];
    body='<div class="full">'+(definition.source?button('dropdown-open-options','Manage options','data-key="'+esc(key)+'"'):'These choices are used by business rules. You can add explanatory wording to each choice.')+'</div>'+
      field('Help text',area('choice_help',v.help||'','maxlength="300"'),'Shown when the dropdown opens.','full')+
      field('Display order',select('designer_order',rows({source:'Source order',ascending:'Alphabetical (A–Z)',descending:'Alphabetical (Z–A)'}),v.order||'source','name','required'))+
      [...new Set<string>([...c.business_fields[key].fixed,...Object.keys(c.presentation[key]?.aliases||{})])].map(code=>field('Additional wording for '+title(code),input('alias_'+code,v.aliases?.[code]||'','text','maxlength="160"'))).join('');
  }
  state.view.dropdownEdit={kind,key,revision:c.revision};
  modal(kind==='presentation'?'Configure '+c.business_fields[key].label:(existing?'Edit ':'Add ')+(kind==='lists'?'choice list':'dropdown field'),
    '<div class="form-grid">'+body+field('Reason for change',area('config_reason',reason,'required minlength="5" maxlength="1000"'),'Recorded in audit history.','full')+'</div>',
    'dropdown-preview','Preview change');
}
function summarize(kind,v) {
  if(!v) return '<p>No previous configuration.</p>';
  if(kind==='lists') return '<strong>'+esc(v.label)+'</strong><ol>'+v.options.map(o=>'<li>'+esc(o.label)+' · '+esc(o.code)+(o.active?'':' · retired')+'</li>').join('')+'</ol>';
  if(kind==='fields') return detailFields([['Field',esc(v.label)],['Form',esc(cat().forms[v.form])],['List',esc(cat().lists[v.source].label)],['Entry',v.active?(v.required?'Required':'Optional'):'Retired']]);
  return detailFields([['Help text',esc(v.help)],['Order',esc(title(v.order))],...Object.entries(v.aliases).map(([k,s])=>[k,esc(s)])]);
}
export function dropdownHandlers({render}) {
  return {actions:{
    'dropdown-open-options':({key})=>{close();location.hash=optionPath(key);},
    'dropdown-edit':({kind,key})=>editor(kind,key),
    'dropdown-add-option':(_data,el)=>el.closest('form').querySelector('[data-choice-rows]').insertAdjacentHTML('beforeend',optionRow()),
    'dropdown-move':(_data,el)=>{const row=el.closest('[data-choice-row]');if(row.previousElementSibling)row.parentElement.insertBefore(row,row.previousElementSibling);},
    'dropdown-remove':(_data,el)=>el.closest('[data-choice-row]').remove(),
    'dropdown-back':()=>{const d=state.view.dropdownChange;editor(d.kind,d.key,d.value,d.reason);},
  },forms:{
    'dropdown-preview':async form=>{
      const {kind,key:original,revision}=state.view.dropdownEdit,e=form.elements;
      const key=kind==='presentation'?original:e.config_key.value.trim();
      if(!original && Object.hasOwn(cat()[kind],key))throw Error('This key already exists. Choose another key or edit the existing entry.');
      let value;
      if(kind==='fields')value={form:e.designer_form.value,source:e.designer_list.value,label:e.config_label.value.trim(),required:e.field_required.checked,active:e.field_active.checked};
      else if(kind==='lists')value={label:e.config_label.value.trim(),options:Array.from(form.querySelectorAll('[data-choice-row]'),(row:HTMLElement)=>({
        code:row.querySelector<HTMLInputElement>('[name=option_code]').value.trim(),label:row.querySelector<HTMLInputElement>('[name=option_label]').value.trim(),active:row.querySelector<HTMLInputElement>('[name=option_active]').checked}))};
      else value={help:e.choice_help.value.trim(),order:e.designer_order.value,aliases:Object.fromEntries([...new Set<string>([...cat().business_fields[key].fixed,...Object.keys(cat().presentation[key]?.aliases||{})])].map(code=>[code,e.namedItem('alias_'+code).value.trim()]).filter(([,s])=>s))};
      const change={kind,key,value,revision,reason:e.config_reason.value.trim()};
      const preview=await api('/admin/dropdowns/preview','POST',change);
      state.view.dropdownChange=change;
      modal('Review dropdown change','<h3>Current</h3>'+summarize(kind,preview.previous)+'<h3>Proposed</h3>'+summarize(kind,preview.proposed)+
        '<p>'+esc(change.reason)+'</p>'+button('dropdown-back','Return to editor'),'dropdown-publish','Publish change');
    },
    'dropdown-publish':async()=>{
      const change=state.view.dropdownChange;
      await api('/admin/dropdowns/publish','POST',change);
      state.masters=await api('/masters');
      close();message('Dropdown configuration published.');await render();
    },
  }};
}
