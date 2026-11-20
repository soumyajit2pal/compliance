"""UAT-only backup and retained-row reconciliation for contextual code migration."""
import hashlib,json,os,sys,io,zipfile
from xml.etree import ElementTree as ET
from pathlib import Path
from datetime import datetime
import sqlalchemy as sa

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.app import models as m
from backend.app.config import load_settings
from backend.app.runtime import runtime_settings
from backend.app.storage import stored_path

OUTPUT=ROOT/'outputs/business-identifiers-2026-11-01'
TARGETS={'cbd_regulatory_instrument','cbd_regulatory_clause','cbd_compliance_obligation'}


def encoded(value):return json.dumps(value,default=str,sort_keys=True,separators=(',',':')).encode()
def digest(value):return hashlib.sha256(encoded(value)).hexdigest()


def snapshot(db):
    present=set(sa.inspect(db).get_table_names());rows={};payload={}
    for name,table in m.metadata.tables.items():
        if name not in present:continue
        data=[dict(r) for r in db.execute(sa.select(table)).mappings()]
        rows[name]={r['id']:digest({k:v for k,v in r.items() if not(name in TARGETS and k=='code')}) for r in data}
        if name in TARGETS:payload[name]=data
    return rows,payload


def main():
    mode=sys.argv[1];settings=load_settings()
    if settings.app_env!='uat':raise RuntimeError('This reconciliation is restricted to UAT.')
    OUTPUT.mkdir(parents=True,exist_ok=True)
    engine=sa.create_engine(settings.database_url,hide_parameters=True)
    with engine.connect() as db:
        rows,payload=snapshot(db)
        if mode=='before':
            stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
            backup=ROOT/'var/backups'/('business-identifiers-'+stamp+'.json');backup.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            descriptor=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(descriptor,'wb') as stream:stream.write(encoded(payload))
            report={'rows':rows,'backup_path':str(backup),'backup_sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),
                'before_codes':{name:[{'id':r['id'],'code':r['code']} for r in data] for name,data in payload.items()}}
            guards={name:''.join(db.execute(sa.text("SELECT text FROM user_source WHERE name=:name AND type='TRIGGER' ORDER BY line"),{'name':name}).scalars()) for name in ['CBD_GUARD_004','CBD_GUARD_006','CBD_GUARD_008','CBD_CLAUSE_IDENTITY_GUARD']}
            report['guard_hashes']={name:digest(sql) for name,sql in guards.items()}
            kyc=[]
            for record in payload['cbd_regulatory_instrument']:
                if 'know your customer' not in record['title'].casefold():continue
                item={key:str(record.get(key)) for key in ['id','code','title','official_reference_number','issue_date','effective_date']}
                for field,table in [('regulator_id',m.regulator),('primary_domain_id',m.regulatory_domain),('instrument_type_id',m.instrument_type)]:
                    item[field]=dict(db.execute(sa.select(table.c.code,table.c.name).where(table.c.id==record[field])).mappings().one())
                document=dict(db.execute(sa.select(m.document).where(m.document.c.id==record['source_document_id'])).mappings().one())
                content=stored_path(runtime_settings().storage,document['id']).read_bytes()
                item['source_file']=document['file_name'];item['source_sha256']=hashlib.sha256(content).hexdigest();item['stored_hash_matches']=item['source_sha256']==document['file_hash']
                if document['file_name'].lower().endswith('.docx'):
                    with zipfile.ZipFile(io.BytesIO(content)) as archive:
                        document_xml=ET.fromstring(archive.read('word/document.xml'))
                        item['document_contains_kyc_title']='know your customer' in ' '.join(document_xml.itertext()).casefold()
                else:item['document_contains_kyc_title']=None
                kyc.append(item)
            (OUTPUT/'kyc-metadata.json').write_text(json.dumps(kyc,indent=2))
            (OUTPUT/'before.json').write_bytes(encoded(report))
            print(json.dumps({'backup_created':True,'tables':len(rows),'code_counts':{k:len(v) for k,v in payload.items()}}))
        elif mode=='after':
            before=json.loads((OUTPUT/'before.json').read_text());changes=[];missing=[]
            for name,items in before['rows'].items():
                for identifier,sha in items.items():
                    if identifier not in rows.get(name,{}):missing.append([name,identifier])
                    elif sha!=rows[name][identifier]:changes.append([name,identifier])
            alias=[dict(r) for r in db.execute(sa.select(m.business_code_alias)).mappings()]
            mapping=[]
            for name,old_rows in before['before_codes'].items():
                kind={'cbd_regulatory_instrument':'instrument','cbd_regulatory_clause':'clause','cbd_compliance_obligation':'obligation'}[name]
                current={r['id']:r for r in payload[name]}
                for old in old_rows:
                    new=current[old['id']]['code'];retained=old['code']==new or any(r[kind+'_id']==old['id'] and r['legacy_code']==old['code'] and r['canonical_code']==new for r in alias)
                    mapping.append({**old,'kind':kind,'canonical_code':new,'legacy_retained':retained})
            result={'unchanged_retained_rows':not changes and not missing,'changed_retained_fields_excluding_codes':changes,'missing_rows':missing,
                'all_legacy_codes_retained':all(r['legacy_retained'] for r in mapping),'mapping':mapping,
                'backup_hash_verified':hashlib.sha256(Path(before['backup_path']).read_bytes()).hexdigest()==before['backup_sha256']}
            result['original_guards_restored']=all(digest(''.join(db.execute(sa.text("SELECT text FROM user_source WHERE name=:name AND type='TRIGGER' ORDER BY line"),{'name':name}).scalars()))==sha for name,sha in before['guard_hashes'].items())
            (OUTPUT/'migration-verification.json').write_text(json.dumps(result,indent=2))
            print(json.dumps({k:v for k,v in result.items() if k!='mapping'}))
            assert result['unchanged_retained_rows'] and result['all_legacy_codes_retained'] and result['backup_hash_verified'] and result['original_guards_restored']
        else:raise ValueError('Use before or after.')


if __name__=='__main__':main()
