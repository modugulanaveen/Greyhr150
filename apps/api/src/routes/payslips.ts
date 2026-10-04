import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { admin } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { writeAudit } from '../lib/audit.js';
import { getMembership, canView, canViewSensitive } from '../lib/authorization.js';

const router=Router(); router.use(requireAuth);
router.use('/generate', rateLimit({max:20,keyPrefix:'payslip-bulk'}));
router.use('/:id/generate', rateLimit({max:30,keyPrefix:'payslip-generate'}));
const uuid=z.string().uuid();
const period=z.object({month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(1900).max(2200)});
const settingsSchema=z.object({company_name:z.string().trim().max(200).optional(),company_address:z.string().trim().max(500).optional(),company_phone:z.string().trim().max(50).optional(),company_email:z.string().email().optional().or(z.literal('')),company_website:z.string().trim().max(200).optional(),payslip_footer:z.string().trim().max(500).optional(),show_pan:z.boolean().optional(),show_uan:z.boolean().optional(),show_bank_account:z.boolean().optional(),mask_bank_account:z.boolean().optional(),mask_pan:z.boolean().optional()}).strict();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024},fileFilter:(_r,f,cb)=>cb(null,['image/png','image/jpeg','image/webp'].includes(f.mimetype))});
function validLogo(buffer:Buffer,mime:string){if(mime==='image/png')return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(mime==='image/jpeg')return buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff;if(mime==='image/webp')return buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP';return false;}
function fy(month:number,year:number){return month>=4?`${year}-${String((year+1)%100).padStart(2,'0')}`:`${year-1}-${String(year%100).padStart(2,'0')}`;}
function monthLabel(month:number,year:number){return new Date(year,month-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'});}
function safeFile(s:string){return s.replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,120);}
function generationError(error:unknown,fallback:string){if(typeof error==='string'&&error.trim())return error;if(error&&typeof error==='object'){const value=error as {message?:unknown;details?:unknown;hint?:unknown};const message=[value.message,value.details,value.hint].filter((part):part is string=>typeof part==='string'&&part.trim().length>0).join(' ');if(message)return message;}return fallback;}
function maskPan(v:string|null|undefined){if(!v)return '-';const s=v.toUpperCase();return s.length>=5?`${s.slice(0,5)}****${s.slice(-1)}`:'****';}
function maskAccount(v:string|null|undefined){if(!v)return '-';const s=String(v);return s.length>4?`XXXX XXXX ${s.slice(-4)}`:'XXXX';}
async function member(req:AuthRequest,companyId:string){return getMembership(req.userId!,companyId);}
async function authorize(req:AuthRequest,companyId:string,write=false){const m=await member(req,companyId);if(!m||!canView(m.role))return null;if(write&&!['OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'].includes(m.role))return null;return m;}
async function loadPayslip(companyId:string,id:string){const {data,error}=await admin.from('payslips').select('*, payroll_runs(*), payroll_records(*, employees(*))').eq('company_id',companyId).eq('id',id).single();if(error)throw error;return data;}
async function latestForRunEmployee(companyId:string,runId:string,employeeId:string){const {data,error}=await admin.from('payslips').select('*').eq('company_id',companyId).eq('payroll_run_id',runId).eq('employee_id',employeeId).order('version',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data;}
async function latestForRecord(companyId:string,recordId:string){const {data:record,error}=await admin.from('payroll_records').select('payroll_run_id,employee_id').eq('company_id',companyId).eq('id',recordId).single();if(error)throw error;return latestForRunEmployee(companyId,record.payroll_run_id,record.employee_id);}
async function branding(companyId:string){const {data}=await admin.from('payslip_settings').select('*').eq('company_id',companyId).maybeSingle();if(data)return data;const {data:company}=await admin.from('companies').select('name,legal_name,state').eq('id',companyId).single();return {company_name:company?.legal_name||company?.name||'PayMate Company',company_address:company?.state||'',payslip_footer:'This is a computer-generated payslip.',show_pan:true,show_uan:true,show_bank_account:true,mask_bank_account:true,mask_pan:true};}
async function employeeSensitive(companyId:string,employeeId:string){const [{data:e,error:ee},{data:b,error:be},{data:s,error:se}]=await Promise.all([admin.from('employees').select('*').eq('company_id',companyId).eq('id',employeeId).single(),admin.from('employee_bank_details').select('*').eq('company_id',companyId).eq('employee_id',employeeId).maybeSingle(),admin.from('employee_statutory_details').select('*').eq('company_id',companyId).eq('employee_id',employeeId).maybeSingle()]);if(ee||be||se)throw ee||be||se;return {employee:e,bank:b,statutory:s};}
function pdfBuffer(data:any):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true});
    const chunks:Buffer[]=[];
    doc.on('data',(chunk:Buffer)=>chunks.push(chunk));
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.on('error',reject);

    const p=data.payroll_record,e=data.employee,b=data.bank,s=data.statutory,c=data.branding,logo=data.logoBuffer;
    const pageWidth=595.28,left=42,right=pageWidth-42,contentWidth=right-left;
    const money=(value:any)=>`₹ ${Math.round(Number(value)||0).toLocaleString('en-IN')}`;
    const label=(value:any)=>String(value||'—');
    const navy='#173D36',blue='#18745F',muted='#71817B',ink='#203733',lineColor='#E3EBE7',pale='#F4F8F6',green='#18745F';
    const rounded=(x:number,y:number,w:number,h:number,r=8)=>doc.roundedRect(x,y,w,h,r);
    const divider=(x:number,y:number,w:number)=>doc.moveTo(x,y).lineTo(x+w,y).lineWidth(.7).strokeColor(lineColor).stroke();
    const text=(value:string,x:number,y:number,w:number,size=9,color=ink,font='Helvetica',align:'left'|'right'='left')=>doc.font(font).fontSize(size).fillColor(color).text(value,x,y,{width:w,ellipsis:true,align});

    // Branded company header
    doc.rect(0,0,pageWidth,142).fill(navy);
    if(logo){try{doc.roundedRect(left,30,66,54,7).fill('#FFFFFF');doc.image(logo,left+6,36,{fit:[54,42]});}catch{}}
    const nameX=logo?left+82:left;
    text(label(c.company_name||'PayMate'),nameX,32,right-nameX,20,'#FFFFFF','Helvetica-Bold');
    const contacts=[c.company_address,c.company_phone,c.company_email,c.company_website].filter(Boolean).join('  •  ');
    if(contacts)text(contacts,nameX,61,right-nameX,8,'#D5DFEF');
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#FFFFFF').text('SALARY PAYSLIP',left,100,{width:contentWidth});
    doc.font('Helvetica').fontSize(10).fillColor('#C7D7F1').text(monthLabel(data.payroll_run.payroll_month,data.payroll_run.payroll_year),left,122);
    const generatedAt=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    doc.fontSize(8).fillColor('#D5DFEF').text(`FINANCIAL YEAR  ${fy(data.payroll_run.payroll_month,data.payroll_run.payroll_year)}     •     GENERATED  ${generatedAt}`,left,124,{width:contentWidth,align:'right'});

    // Employee identity and pay period details
    let y=160;
    rounded(left,y,contentWidth,100).fill(pale);
    text('EMPLOYEE DETAILS',left+16,y+13,contentWidth-32,8,blue,'Helvetica-Bold');
    text(`${label(e.first_name)} ${label(e.last_name)}`,left+16,y+30,contentWidth-32,16,navy,'Helvetica-Bold');
    const colW=(contentWidth-32)/3;
    const details=[
      ['EMPLOYEE ID',label(e.employee_id)],
      ['DESIGNATION',label(e.designation)],
      ['DEPARTMENT',label(e.department_name||e.departments?.name||e.department)],
      ['DATE OF JOINING',label(e.date_of_joining)],
      ['PAID DAYS',String(p.paid_days??'—')],
      ['LOSS OF PAY DAYS',String(p.lop_days??0)],
    ];
    details.forEach(([k,v],i)=>{const row=Math.floor(i/3),col=i%3,x=left+16+col*colW,dy=y+57+row*25;text(String(k),x,dy,colW-10,7,muted,'Helvetica-Bold');text(String(v),x,dy+10,colW-10,9,ink,'Helvetica-Bold');});
    y+=118;

    const gap=14,tableW=(contentWidth-gap)/2,tableX2=left+tableW+gap;
    const drawTable=(x:number,title:string,items:[string,any][],totalTitle:string,total:any)=>{
      rounded(x,y,tableW,22,5).fill(navy);
      text(title.toUpperCase(),x+11,y+7,tableW-22,8,'#FFFFFF','Helvetica-Bold');
      let rowY=y+34;
      for(const [name,value] of items){text(name,x+3,rowY,tableW-82,9,muted);text(money(value),x+tableW-78,rowY,75,9,ink,'Helvetica','right');rowY+=23;divider(x+3,rowY-7,tableW-6);}
      rounded(x,rowY+1,tableW,34,5).fill('#F0F4FA');
      text(totalTitle,x+10,rowY+12,tableW-90,8,navy,'Helvetica-Bold');
      doc.font('Helvetica-Bold').fontSize(10).fillColor(navy).text(money(total),x+tableW-92,rowY+10,{width:82,align:'right'});
      return rowY+46;
    };
    const adjustments:any[]=Array.isArray(data.adjustments)?data.adjustments:[];
    const adjustmentDirection=(item:any)=>item.component_type??(item.adjustment_type==='OTHER_DEDUCTION'?'DEDUCTION':'EARNING');
    const adjustmentName=(item:any)=>item.component_name||String(item.adjustment_type||'Adjustment').replaceAll('_',' ');
    const earningAdjustments=adjustments.filter((item)=>adjustmentDirection(item)==='EARNING');
    const deductionAdjustments=adjustments.filter((item)=>adjustmentDirection(item)==='DEDUCTION');
    const earnItems:[string,any][]=[['Basic salary',p.basic_salary],['Special allowance',p.special_allowance]];
    if(earningAdjustments.length)earningAdjustments.forEach((item)=>earnItems.push([adjustmentName(item),item.amount]));
    else if(Number(p.adjustment_earnings))earnItems.push(['Other earnings',p.adjustment_earnings]);
    const deductionItems:[string,any][]=[['Employee PF',p.employee_pf],['Professional tax',p.professional_tax],['TDS',p.tds]];
    if(Number(p.other_deductions))deductionItems.push(['Other deductions',p.other_deductions]);
    if(deductionAdjustments.length)deductionAdjustments.forEach((item)=>deductionItems.push([adjustmentName(item),item.amount]));
    else if(Number(p.adjustment_deductions))deductionItems.push(['Adjustment deductions',p.adjustment_deductions]);
    const leftBottom=drawTable(left,'Earnings',earnItems,'Total earnings',p.adjusted_gross);
    const rightBottom=drawTable(tableX2,'Deductions',deductionItems,'Total deductions',p.total_deductions);
    y=Math.max(leftBottom,rightBottom)+12;

    // Net pay summary
    rounded(left,y,contentWidth,67,8).fill('#EAF6F0');
    text('NET PAY',left+16,y+14,contentWidth-32,9,green,'Helvetica-Bold');
    doc.font('Helvetica-Bold').fontSize(23).fillColor(green).text(money(p.net_salary),left+16,y+30,{width:contentWidth-32});
    doc.font('Helvetica').fontSize(8).fillColor(muted).text('Take-home pay for this period',left+16,y+53);
    y+=82;

    // Statutory and employer information
    const infoW=(contentWidth-14)/2;
    rounded(left,y,infoW,72,7).lineWidth(.8).strokeColor(lineColor).stroke();
    rounded(left+infoW+14,y,infoW,72,7).lineWidth(.8).strokeColor(lineColor).stroke();
    text('EMPLOYER CONTRIBUTIONS',left+12,y+12,infoW-24,8,blue,'Helvetica-Bold');
    text('Employer PF',left+12,y+32,infoW-110,9,muted);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text(money(p.employer_pf),left+infoW-92,y+32,{width:80,align:'right'});
    text('Total employer cost',left+12,y+49,infoW-110,8,muted);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text(money(p.employer_cost),left+infoW-92,y+49,{width:80,align:'right'});
    text('PAYMENT & STATUTORY DETAILS',left+infoW+26,y+12,infoW-24,8,blue,'Helvetica-Bold');
    const bankLine=c.show_bank_account?`${label(b?.bank_name)}  •  ${c.mask_bank_account?maskAccount(b?.account_number):label(b?.account_number)}`:'Bank details are not shown';
    text(`BANK  ${bankLine}`,left+infoW+26,y+31,infoW-44,8,ink);
    const statutoryLine=[c.show_pan?`PAN ${c.mask_pan?maskPan(s?.pan):label(s?.pan)}`:'',c.show_uan?`UAN ${label(s?.uan)}`:''].filter(Boolean).join('  •  ');
    if(statutoryLine)text(statutoryLine,left+infoW+26,y+48,infoW-44,8,ink);

    const footerY=785;
    divider(left,footerY,contentWidth);
    text(c.payslip_footer||'This is a computer-generated payslip.',left,footerY+12,contentWidth,8,muted);
    text('CONFIDENTIAL  •  For employee records',left,footerY+27,contentWidth/2,7,muted,'Helvetica-Bold');
    text(`PayMate  |  ${data.payroll_run.payroll_year}-${String(data.payroll_run.payroll_month).padStart(2,'0')}`,left+contentWidth/2,footerY+27,contentWidth/2,7,muted,'Helvetica','right');
    doc.end();
  });
}
async function generateOne(companyId:string,userId:string,recordId:string,existing?:any){
  const {data:record,error}=await admin.from('payroll_records').select('*, employees(*,departments(name))').eq('company_id',companyId).eq('id',recordId).single();
  if(error||!record)throw new Error('Payroll record not found');
  const {data:run,error:runError}=await admin.from('payroll_runs').select('*').eq('company_id',companyId).eq('id',record.payroll_run_id).single();
  if(runError||!run)throw new Error('Payroll run not found');
  if(!['APPROVED','LOCKED'].includes(run.status))throw new Error('Payslips can be generated after payroll is approved.');
  let adjustmentColumns='id,adjustment_type,amount,reason,notes,component_name,component_type,component_taxable,voided';
  let filterVoided=true;
  let adjustmentResult:any;
  for(let attempt=0;attempt<4;attempt++){
    let query=admin.from('payroll_adjustments').select(adjustmentColumns).eq('company_id',companyId).eq('payroll_run_id',run.id).eq('employee_id',record.employee_id);
    if(filterVoided)query=query.eq('voided',false);
    adjustmentResult=await query;
    if(!adjustmentResult.error)break;
    if(adjustmentResult.error.code!=='42703')throw adjustmentResult.error;
    if(adjustmentResult.error.message.includes('voided'))filterVoided=false;
    else adjustmentColumns='id,adjustment_type,amount,reason,notes';
  }
  if(adjustmentResult.error)throw adjustmentResult.error;
  const adjustments=adjustmentResult.data;
  const sens=await employeeSensitive(companyId,record.employee_id);
  const employee={...sens.employee,department_name:record.employees?.departments?.name||null};
  const brand=await branding(companyId);
  let logoBuffer:Buffer|undefined;
  if(brand.company_logo_path){const logo=await admin.storage.from('payslip-branding').download(brand.company_logo_path);if(!logo.error&&logo.data)logoBuffer=Buffer.from(await logo.data.arrayBuffer());}
  const version=existing?Number(existing.version)+1:1;
  const employeeId=sens.employee.employee_id;
  const fileName=`PAYSLIP_${safeFile(employeeId)}_${run.payroll_year}-${String(run.payroll_month).padStart(2,'0')}.pdf`;
  const recordSnapshot={...record};
  delete recordSnapshot.employees;
  const snapshot={employee:{id:sens.employee.id,employee_id:sens.employee.employee_id,first_name:sens.employee.first_name,last_name:sens.employee.last_name,designation:sens.employee.designation,department:employee.department_name,date_of_joining:sens.employee.date_of_joining},bank:sens.bank?{bank_name:sens.bank.bank_name,account_number:sens.bank.account_number}:null,statutory:sens.statutory?{pan:sens.statutory.pan,uan:sens.statutory.uan,pf_member_id:sens.statutory.pf_member_id}:null,branding:brand,payroll_record:recordSnapshot,adjustments:adjustments??[]};
  const buffer=await pdfBuffer({payroll_record:record,employee,bank:sens.bank,statutory:sens.statutory,branding:brand,logoBuffer,payroll_run:run,adjustments:adjustments??[]});
  const hash=crypto.createHash('sha256').update(buffer).digest('hex');
  const path=`company/${companyId}/${fy(run.payroll_month,run.payroll_year)}/${run.payroll_year}-${String(run.payroll_month).padStart(2,'0')}/${safeFile(employeeId)}/v${version}/${fileName}`;
  const uploadResult=await admin.storage.from('payslips').upload(path,buffer,{contentType:'application/pdf',upsert:false});
  if(uploadResult.error)throw uploadResult.error;
  const {data:ps,error:insertError}=await admin.from('payslips').insert({company_id:companyId,payroll_run_id:run.id,payroll_record_id:record.id,employee_id:record.employee_id,pay_period_month:run.payroll_month,pay_period_year:run.payroll_year,financial_year:fy(run.payroll_month,run.payroll_year),file_path:path,file_name:fileName,status:'GENERATED',generated_at:new Date().toISOString(),generated_by:userId,file_hash:hash,version,snapshot}).select('*').single();
  if(insertError)throw insertError;
  await admin.from('payroll_audit_logs').insert({company_id:companyId,payroll_run_id:run.id,employee_id:record.employee_id,user_id:userId,action:existing?'PAYSLIP_REGENERATED':'PAYSLIP_GENERATED',metadata:{payslip_id:ps.id,version}});
  await writeAudit(companyId,userId,existing?'PAYSLIP_REGENERATED':'PAYSLIP_GENERATED','PAYSLIP',ps.id,{payroll_run_id:run.id,employee_id:record.employee_id,version});
  return ps;
}
router.get('/',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId);if(!m)return res.status(403).json({error:'Company access denied'});const q=period.partial().safeParse(req.query);let query=admin.from('payroll_runs').select('id,payroll_month,payroll_year,status').eq('company_id',companyId).order('payroll_year',{ascending:false}).order('payroll_month',{ascending:false});if(q.success&&q.data.month)query=query.eq('payroll_month',q.data.month);if(q.success&&q.data.year)query=query.eq('payroll_year',q.data.year);const {data:runs,error}=await query.limit(24);if(error)throw error;const out:any[]=[];for(const run of runs??[]){let rq=admin.from('payroll_records').select('id,employee_id,adjusted_gross,total_deductions,net_salary,employees(employee_id,first_name,last_name,work_location,departments(name))').eq('company_id',companyId).eq('payroll_run_id',run.id).order('employee_id');if(req.query.search)rq=rq.or(`employee_id.ilike.%${String(req.query.search)}%,first_name.ilike.%${String(req.query.search)}%,last_name.ilike.%${String(req.query.search)}%`,{foreignTable:'employees'});const {data:records,error:re}=await rq;if(re)throw re;for(const r of records??[]){const ps=await latestForRunEmployee(companyId,run.id,r.employee_id);out.push({...r,run,payslip:ps});}}res.json({payslips:out});}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to load payslips'});}});
router.get('/settings',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId,true);if(!m||!['OWNER','COMPANY_ADMIN'].includes(m.role))return res.status(403).json({error:'Administrator access required'});res.json({settings:await branding(companyId)});}catch(e){res.status(400).json({error:'Unable to load payslip settings'});}});
router.put('/settings',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId,true);if(!m||!['OWNER','COMPANY_ADMIN'].includes(m.role))return res.status(403).json({error:'Administrator access required'});const body=settingsSchema.parse(req.body);const {data,error}=await admin.from('payslip_settings').upsert({company_id:companyId,...body}).select('*').single();if(error)throw error;res.json({settings:data});}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Invalid settings'});}});
router.post('/settings/logo',upload.single('logo'),async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId,true);if(!m||!['OWNER','COMPANY_ADMIN'].includes(m.role))return res.status(403).json({error:'Administrator access required'});if(!req.file||!validLogo(req.file.buffer,req.file.mimetype))return res.status(400).json({error:'Invalid logo file'});const ext=req.file.mimetype==='image/png'?'png':req.file.mimetype==='image/webp'?'webp':'jpg';const path=`company/${companyId}/logo.${ext}`;const up=await admin.storage.from('payslip-branding').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:true});if(up.error)throw up.error;await admin.from('payslip_settings').upsert({company_id:companyId,company_logo_path:path});res.json({path});}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to upload logo'});}});
router.get('/:id',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId);if(!m)return res.status(403).json({error:'Company access denied'});const ps=await loadPayslip(companyId,uuid.parse(req.params.id));const sens=await employeeSensitive(companyId,ps.employee_id);const brand=await branding(companyId);const snap=ps.snapshot||{};const hasPayrollSnapshot=Boolean(snap.payroll_record);res.json({payslip:ps,employee:snap.employee||sens.employee,bank:canViewSensitive(m.role)?(hasPayrollSnapshot?snap.bank:(snap.bank||sens.bank)):null,statutory:canViewSensitive(m.role)?(hasPayrollSnapshot?snap.statutory:(snap.statutory||sens.statutory)):null,branding:snap.branding||brand});}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to load payslip'});}});
router.post('/:id/generate',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId,true);if(!m)return res.status(403).json({error:'Insufficient permissions'});const ps=await loadPayslip(companyId,uuid.parse(req.params.id));const {data:record,error}=await admin.from('payroll_records').select('id').eq('company_id',companyId).eq('payroll_run_id',ps.payroll_run_id).eq('employee_id',ps.employee_id).single();if(error||!record)throw new Error('Current payroll record not found. Recalculate and lock payroll before regenerating its payslip.');const latest=await latestForRunEmployee(companyId,ps.payroll_run_id,ps.employee_id);const created=await generateOne(companyId,req.userId!,record.id,latest);res.json({payslip:created});}catch(e){res.status(400).json({error:generationError(e,'Payslip generation failed')});}});
router.post('/generate',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId,true);if(!m)return res.status(403).json({error:'Insufficient permissions'});const ids=z.array(uuid).min(1).max(500).parse(req.body.record_ids);const results:any[]=[];for(const id of ids){try{const latest=await latestForRecord(companyId,id);results.push(await generateOne(companyId,req.userId!,id,latest));}catch(e){results.push({record_id:id,status:'FAILED',error:generationError(e,'Generation failed')});}}res.json({results,generated:results.filter(x=>x.status==='GENERATED').length,failed:results.filter(x=>x.status==='FAILED').length});}catch(e){res.status(400).json({error:generationError(e,'Invalid generation request')});}});
router.get('/:id/download',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId);if(!m)return res.status(403).json({error:'Company access denied'});const ps=await loadPayslip(companyId,uuid.parse(req.params.id));if(ps.status!=='GENERATED'||!ps.file_path)return res.status(404).json({error:'Payslip is not generated'});const {data,error}=await admin.storage.from('payslips').createSignedUrl(ps.file_path,120);if(error)throw error;await admin.from('payroll_audit_logs').insert({company_id:companyId,payroll_run_id:ps.payroll_run_id,employee_id:ps.employee_id,user_id:req.userId,action:'PAYSLIP_DOWNLOADED',metadata:{payslip_id:ps.id,version:ps.version}});res.json({url:data.signedUrl,file_name:ps.file_name});}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to create download URL'});}});
router.get('/bulk/download',async(req:AuthRequest,res)=>{try{const companyId=uuid.parse(String(req.query.company_id));const m=await authorize(req,companyId);if(!m)return res.status(403).json({error:'Company access denied'});const ids=z.array(uuid).min(1).max(500).parse(String(req.query.ids||'').split(',').filter(Boolean));const archive=archiver('zip',{zlib:{level:6}});res.attachment(`PAYSLIPS_${String(req.query.year)}-${String(req.query.month).padStart(2,'0')}.zip`);archive.on('error',err=>{if(!res.headersSent)res.status(500).end();else res.end();});archive.pipe(res);for(const id of ids){const ps=await loadPayslip(companyId,id);if(ps.status!=='GENERATED'||!ps.file_path)continue;const {data,error}=await admin.storage.from('payslips').download(ps.file_path);if(error||!data)continue;archive.append(Buffer.from(await data.arrayBuffer()),{name:ps.file_name});}await archive.finalize();}catch(e){if(!res.headersSent)res.status(400).json({error:e instanceof Error?e.message:'Unable to create ZIP'});}});
export default router;
