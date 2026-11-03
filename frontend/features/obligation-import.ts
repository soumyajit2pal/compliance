import { api } from '../core/api.ts';
import { state } from '../core/state.ts';
import { has } from '../core/access.ts';
import { apiPageQuery } from '../core/pagination.ts';
import { esc,field,input,button,link,badge,date,message } from '../ui/components.ts';
import { heading } from '../ui/layout.ts';
import { panel,table,tablePanel,note,detailFields } from '../ui/widgets.ts';
import { modal,close } from '../ui/dialog.ts';
import { obligationSummary,ownershipSummary,applicabilitySummary,processSummary } from './obligation-summary.ts';

export async function obligationImportsPage(query){
  const identifier=query.get('batch');
  if(identifier){
    const data=await api('/obligation-imports/'+identifier);state.view.obligationImport=data;
    const b=data.batch,notes=JSON.parse(b.reconciliation_notes),canValidate=has('REVIEWER')&&b.uploaded_by!==state.identity.user.id&&b.record_status==='OBL_STAGED';
    const canLoad=has('AUTHOR')&&b.uploaded_by===state.identity.user.id&&b.record_status==='OBL_VALIDATED'&&data.ready_obligations>0;
    return link('obligations/imports','← Obligation imports','back-link')+
      heading(b.source_file,b.code,(canValidate?button('obl-import-validate','Validate import','','primary'):'')+
        (canLoad?button('obl-import-confirm','Load '+data.ready_obligations+' ready Draft obligation(s)','','primary'):'')+
        (has('AUTHOR')&&b.uploaded_by===state.identity.user.id&&!notes.corrected_by_batch_id&&b.loaded_count<b.source_count?button('obl-import-correct','Upload corrected workbook'):'')+
        `<a class="btn" href="/api/obligation-imports/${esc(identifier)}/report.csv" download>Download reconciliation</a><a class="btn" href="/api/obligation-imports/${esc(identifier)}/source" download>Original workbook</a>`)+
      (notes.replaces_batch_id?note('Corrects '+link('obligations/imports?batch='+notes.replaces_batch_id,'the retained earlier workbook')+'. Earlier files and findings remain available.'):'')+
      (notes.corrected_by_batch_id?note('A '+link('obligations/imports?batch='+notes.corrected_by_batch_id,'linked correction')+' is available. Retained rows and loaded targets are preserved.'):'')+
      panel('Import reconciliation',detailFields([['Status',badge(b.record_status.replace(/^OBL_/,''))],['Source system',esc(notes.source_system)],['Atomic obligation groups',esc(data.obligation_count)],
        ['Source rows',esc(b.source_count)],['Loaded source rows',esc(b.loaded_count)],['Correction / not loaded rows',esc(b.rejected_count)],['Pending source rows',esc(b.pending_count)]]))+
      note('Only complete, valid groups load into Draft. Source file, sheet, row and legacy references are retained. Loading does not approve ownership, applicability or obligation activation.')+
      tablePanel(table(['Sheet / row','Import reference','Readiness','Findings','Loaded obligation'],data.rows.map(r=>[
        esc(r.sheet_name)+' · '+r.row_number,esc(r.profile.reference),badge(r.validation_status),
        ((r.profile.errors||[]).map(error=>`<p>${esc(error)}</p>`).join('')||'No structural findings')+
          `<details><summary>Original row values</summary>${detailFields(Object.entries(JSON.parse(r.source_payload)).map(([key,value])=>[esc(key.replaceAll('_',' ')),esc(value??'—')]))}</details>`,
        r.target_entity_id?link('obligations/'+r.target_entity_id,'Open Draft obligation')+'<small>'+esc(r.profile.target_code)+'</small>':'—',
      ]),{pageKey:'obligation-import-rows'}))+
      data.rows.filter(r=>r.sheet_name==='Obligations'&&r.profile.normalised).map(r=>{
        const p=r.profile.normalised;
        return panel('Mapped obligation · '+r.profile.reference,`<details><summary>Review requirement, source, owners and applicability</summary>${obligationSummary(p)}
          <p>${link('clauses?clause='+p.primary_clause_id,'Open exact primary source clause','text-link')}</p>
          ${ownershipSummary(p.owners)}${applicabilitySummary(p.applicability)}${processSummary(p.processes)}</details>`);
      }).join('');
  }
  const result=await api('/obligation-imports?'+apiPageQuery(query,'obligation-imports'));
  return link('obligations','← Obligation register','back-link')+
    heading('Import obligations','Use approved regulatory clauses; load owned, assessed requirements into Draft.',
      '<a class="btn" href="/api/obligation-import-template" download>Download Excel template</a>'+(has('AUTHOR')?button('obl-import-new','Upload obligations','','primary'):''))+
    note('Fill Obligations, Owners, Applicability and Processes using one import reference per atomic requirement. An independent Reviewer validates the import before the uploader loads ready Drafts.')+
    tablePanel(table(['Source workbook','Date','Status','Source rows','Loaded','Not loaded'],result.items.map(b=>[
      link('obligations/imports?batch='+b.id,b.source_file),date(b.uploaded_at),badge(b.record_status.replace(/^OBL_/,'')),esc(b.source_count),esc(b.loaded_count),esc(b.rejected_count),
    ]),{pageKey:'obligation-imports',pagination:result.pagination}));
}

export function obligationImportHandlers({render}){
  return {actions:{
    'obl-import-new':()=>modal('Upload obligation workbook',field('Source system',input('source_system','','text','required maxlength="90"'))+
      field('Obligation Excel workbook',input('file','','file','required accept=".xlsx"')),'obl-import-upload','Preview validation'),
    'obl-import-correct':()=>{
      const b=state.view.obligationImport.batch,notes=JSON.parse(b.reconciliation_notes);
      modal('Upload corrected obligation workbook',input('replaces_batch_id',b.id,'hidden')+field('Source system',input('source_system',notes.source_system,'text','required readonly'))+
        field('Corrected Excel workbook',input('file','','file','required accept=".xlsx"')),'obl-import-upload','Preview linked correction');
    },
    'obl-import-validate':async()=>{await api('/obligation-imports/'+state.view.obligationImport.batch.id+'/validate','POST',{});await render();},
    'obl-import-confirm':()=>modal('Load ready Draft obligations',note('Only complete ready groups will load. Other rows remain in the reconciliation report. Approval and activation still require the full obligation workflow.'),'obl-import-load','Load ready Drafts'),
  },forms:{
    'obl-import-upload':async form=>{const result=await api('/obligation-imports','POST',new FormData(form));close();location.hash='obligations/imports?batch='+result.id;},
    'obl-import-load':async()=>{const result=await api('/obligation-imports/'+state.view.obligationImport.batch.id+'/load','POST',{});close();message(result.loaded_obligations+' Draft obligation(s) loaded. '+(result.message||''));await render();},
  }};
}
