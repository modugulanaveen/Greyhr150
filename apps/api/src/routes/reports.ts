import { Router } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { admin } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateCommonQuery } from '../middleware/validate.js';
import { canView, getMembership } from '../lib/authorization.js';

const router = Router();
router.use(requireAuth);
router.use(validateCommonQuery);
router.use('/:type/export', rateLimit({max:20,keyPrefix:'report-export'}));
const uuid = z.string().uuid();
const typeValues = ['payroll','summary','employees','joiners','exits','salary','salary-revisions','attendance','lop','deductions','employer-cost','statutory','payslips'] as const;
type ReportType = typeof typeValues[number];
const reportType = z.enum(typeValues);

function fy(month:number, year:number){ return month >= 4 ? `${year}-${String((year+1)%100).padStart(2,'0')}` : `${year-1}-${String(year%100).padStart(2,'0')}`; }
function monthLabel(month:number, year:number){ return new Date(Date.UTC(year,month-1,1)).toLocaleString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}); }
function money(v:any){ return Math.round(Number(v)||0); }
function maskPan(v:any){ const s=String(v??''); return s.length >= 4 ? `${'*'.repeat(Math.max(0,s.length-4))}${s.slice(-4)}` : (s?'****':''); }
function maskBank(v:any){ const s=String(v??''); return s.length >= 4 ? `${'*'.repeat(Math.max(0,s.length-4))}${s.slice(-4)}` : (s?'****':''); }

async function membership(req:AuthRequest, companyId:string){
  const m = await getMembership(req.userId!, companyId);
  return m && canView(m.role) ? m : null;
}
async function audit(companyId:string,userId:string,action:string,reportType:string,metadata:any={}){
  await admin.from('audit_logs').insert({company_id:companyId,user_id:userId,action,entity_type:'REPORT',metadata:{report_type:reportType,...metadata}});
}
async function companyName(companyId:string){
  const {data} = await admin.from('companies').select('name,legal_name').eq('id',companyId).single();
  return data?.name || data?.legal_name || 'Company';
}
async function resolveRun(companyId:string,month?:number,year?:number,runId?:string,approvedOnly=true,financialYear?:string){
  if(runId){
    const {data,error}=await admin.from('payroll_runs').select('*').eq('company_id',companyId).eq('id',runId).single();
    if(error) throw error;
    if(approvedOnly && !['APPROVED','LOCKED'].includes(data.status)) return null;
    return data;
  }
  let q=admin.from('payroll_runs').select('*').eq('company_id',companyId).order('payroll_year',{ascending:false}).order('payroll_month',{ascending:false}).limit(50);
  if(financialYear && /^20\d{2}-\d{2}$/.test(financialYear)){const start=Number(financialYear.slice(0,4)); q=q.gte('payroll_year',start).lte('payroll_year',start+1);}
  if(month) q=q.eq('payroll_month',month);
  if(year) q=q.eq('payroll_year',year);
  if(approvedOnly) q=q.in('status',['APPROVED','LOCKED']);
  const {data,error}=await q;
  if(error) throw error;
  const list=(data??[]).filter((r:any)=>!financialYear || fy(r.payroll_month,r.payroll_year)===financialYear);
  return list[0]??null;
}
async function runRecords(companyId:string,runId:string){
  const {data,error}=await admin.from('payroll_records').select('*, employees(employee_id,first_name,last_name,department_id,designation,employment_type,date_of_joining,last_working_date,departments(name))').eq('company_id',companyId).eq('payroll_run_id',runId).order('employee_id');
  if(error) throw error;
  return data??[];
}
async function departments(companyId:string){
  const {data,error}=await admin.from('departments').select('id,name').eq('company_id',companyId).order('name');
  if(error) throw error;
  return data??[];
}
function recordRow(r:any){
  const e=Array.isArray(r.employees)?r.employees[0]:r.employees;
  const dept=e?.departments?.name??'Unassigned';
  return {
    employee_id:e?.employee_id??'', employee_name:`${e?.first_name??''} ${e?.last_name??''}`.trim(), department:dept, department_id:e?.department_id??null,
    designation:e?.designation??'', employment_type:e?.employment_type??'', joining_date:e?.date_of_joining??null,
    exit_date:e?.last_working_date??null, paid_days:Number(r.paid_days??0), working_days:Number(r.working_days??0),
    present_days:Number(r.present_days??0), paid_leave_days:Number(r.paid_leave_days??0), lop_days:Number(r.lop_days??0),
    basic:Number(r.basic_salary??0), special_allowance:Number(r.special_allowance??0), other_earnings:Number(r.adjustment_earnings??0),
    gross:Number(r.gross_salary??0), adjusted_gross:Number(r.adjusted_gross??0), employee_pf:Number(r.employee_pf??0),
    pt:Number(r.professional_tax??0), tds:Number(r.tds??0), lop_deduction:Number(r.lop_deduction??0),
    other_deductions:Number((r.other_deductions??0)+(r.adjustment_deductions??0)), total_deductions:Number(r.total_deductions??0),
    net_pay:Number(r.net_salary??0), employer_pf:Number(r.employer_pf??0), employer_cost:Number(r.employer_cost??0), employee_id_uuid:r.employee_id
  };
}
async function filteredRecords(companyId:string,runId:string,filters:any){
  let rows=(await runRecords(companyId,runId)).map(recordRow);
  if(filters.department_id) rows=rows.filter(r=>r.department_id===filters.department_id);
  if(filters.employee_id) rows=rows.filter(r=>r.employee_id_uuid===filters.employee_id);
  return rows;
}

router.get('/dashboard', async(req:AuthRequest,res)=>{
  try{
    const companyId=uuid.parse(String(req.query.company_id)); const m=await membership(req,companyId); if(!m) return res.status(403).json({error:'Company access denied'});
    const requestedMonth=req.query.month?Number(req.query.month):undefined, requestedYear=req.query.year?Number(req.query.year):undefined;
    const selected=await resolveRun(companyId,requestedMonth,requestedYear,req.query.payroll_run_id?String(req.query.payroll_run_id):undefined,true);
    const latest=await resolveRun(companyId,undefined,undefined,undefined,false);
    if(!selected){ return res.json({company:{name:await companyName(companyId)},latestRun:latest,selectedRun:null,empty:true,financial_year:requestedMonth&&requestedYear?fy(requestedMonth,requestedYear):null}); }
    const rows=(await runRecords(companyId,selected.id)).map(recordRow);
    const totals=rows.reduce((a,r)=>({gross:a.gross+r.gross,net:a.net+r.net_pay,deductions:a.deductions+r.total_deductions,employer:a.employer+r.employer_cost-r.gross,employerCost:a.employerCost+r.employer_cost,pf:a.pf+r.employee_pf,pt:a.pt+r.pt,tds:a.tds+r.tds,lop:a.lop+r.lop_deduction,lopDays:a.lopDays+r.lop_days,paidDays:a.paidDays+r.paid_days,workingDays:a.workingDays+r.working_days,presentDays:a.presentDays+r.present_days,leave:a.leave+r.paid_leave_days}),{gross:0,net:0,deductions:0,employer:0,employerCost:0,pf:0,pt:0,tds:0,lop:0,lopDays:0,paidDays:0,workingDays:0,presentDays:0,leave:0});
    const [allEmployees,trendRuns,deptRows,liabs,payments,attendance]=await Promise.all([
      admin.from('employees').select('id,department_id,date_of_joining,last_working_date,employment_status').eq('company_id',companyId),
      admin.from('payroll_runs').select('id,payroll_month,payroll_year,gross_total,net_salary_total,employer_cost_total,status').eq('company_id',companyId).in('status',['APPROVED','LOCKED']).order('payroll_year',{ascending:false}).order('payroll_month',{ascending:false}).limit(12),
      admin.from('departments').select('id,name').eq('company_id',companyId),
      admin.from('statutory_liabilities').select('*').eq('company_id',companyId).eq('payroll_run_id',selected.id),
      admin.from('statutory_payments').select('*').eq('company_id',companyId),
      admin.from('attendance_records').select('working_days,present_days,paid_leave_days,lop_days,paid_days,employee_id').eq('company_id',companyId).eq('payroll_month',selected.payroll_month).eq('payroll_year',selected.payroll_year)
    ]);
    for(const x of [allEmployees,trendRuns,deptRows,liabs,payments,attendance]) if(x.error) throw x.error;
    const deptAgg=new Map<string,any>();
    for(const r of rows){ const name=r.department||'Unassigned'; const d=deptAgg.get(name)||{department:name,employees:0,gross:0,net:0,employerCost:0}; d.employees++; d.gross+=r.gross; d.net+=r.net_pay; d.employerCost+=r.employer_cost; deptAgg.set(name,d); }
    const salaryBuckets=[['Below ₹20,000',0,20000],['₹20,000–₹30,000',20000,30000],['₹30,000–₹50,000',30000,50000],['₹50,000–₹75,000',50000,75000],['₹75,000–₹1,00,000',75000,100000],['Above ₹1,00,000',100000,Infinity]];
    const salaryDistribution=salaryBuckets.map(([label,min,max])=>({label,count:rows.filter(r=>r.gross>=Number(min)&&(r.gross<(Number(max)||Infinity))).length}));
    const paidMap=new Map((attendance.data??[]).map((a:any)=>[a.employee_id,a]));
    const attendanceSummary=(attendance.data??[]).reduce((a:any,r:any)=>({working:a.working+Number(r.working_days||0),present:a.present+Number(r.present_days||0),leave:a.leave+Number(r.paid_leave_days||0),lop:a.lop+Number(r.lop_days||0),paid:a.paid+Number(r.paid_days||0)}),{working:0,present:0,leave:0,lop:0,paid:0});
    const paidByLiability=new Map<string,number>(); for(const p of payments.data??[]){paidByLiability.set(p.liability_id,(paidByLiability.get(p.liability_id)||0)+Number(p.amount||0));}
    const statutory=(liabs.data??[]).map((l:any)=>{const paid=paidByLiability.get(l.id)||0; const balance=Math.max(0,Number(l.amount)-paid); const status=balance<=0?'PAID':(l.due_date&&new Date(l.due_date)<new Date()?'OVERDUE':paid>0?'PARTIALLY_PAID':'PENDING'); return {type:l.statutory_type,liability:Number(l.amount),paid,balance,status,due_date:l.due_date};});
    const headcount=(allEmployees.data??[]).length, active=(allEmployees.data??[]).filter((e:any)=>e.employment_status==='ACTIVE').length;
    const joiners=(allEmployees.data??[]).filter((e:any)=>String(e.date_of_joining).slice(0,7)===`${selected.payroll_year}-${String(selected.payroll_month).padStart(2,'0')}`).length;
    const exited=(allEmployees.data??[]).filter((e:any)=>e.last_working_date&&String(e.last_working_date).slice(0,7)===`${selected.payroll_year}-${String(selected.payroll_month).padStart(2,'0')}`).length;
    const trend=await Promise.all((trendRuns.data??[]).slice().reverse().map(async(run:any)=>({period:monthLabel(run.payroll_month,run.payroll_year),month:run.payroll_month,year:run.payroll_year,gross:Number(run.gross_total),net:Number(run.net_salary_total),employerCost:Number(run.employer_cost_total)})));
    const trendHeadcount=trend.map(t=>{ const emps=allEmployees.data??[]; const end=`${t.year}-${String(t.month).padStart(2,'0')}`; const activeAtMonth=emps.filter((e:any)=>String(e.date_of_joining)<=`${end}-31` && (!e.last_working_date || String(e.last_working_date)>=`${end}-01`)).length; const joinersMonth=emps.filter((e:any)=>String(e.date_of_joining).slice(0,7)===end).length; const exitsMonth=emps.filter((e:any)=>e.last_working_date&&String(e.last_working_date).slice(0,7)===end).length; return {...t,activeEmployees:activeAtMonth,joiners:joinersMonth,exited:exitsMonth}; });
    const status={month:monthLabel(selected.payroll_month,selected.payroll_year),employeeCount:selected.employee_count,lastUpdated:selected.updated_at,status:selected.status,id:selected.id};
    res.json({company:{name:await companyName(companyId)},financial_year:fy(selected.payroll_month,selected.payroll_year),selectedRun:selected,latestRun:latest,kpis:{totalEmployees:headcount,activeEmployees:active,currentMonthPayroll:totals.employerCost,grossPayroll:totals.gross,netPayroll:totals.net,totalDeductions:totals.deductions,employerContributions:totals.employer,employeePf:totals.pf,pt:totals.pt,tds:totals.tds},summary:{gross:totals.gross,deductions:totals.deductions,net:totals.net,employerContributions:totals.employer,employerCost:totals.employerCost},trend:trendHeadcount,headcount:{active,joiners,exited},departments:Array.from(deptAgg.values()),salaryDistribution,attendance:{...attendanceSummary,lopDeduction:totals.lop},statutory,status,empty:false});
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to load dashboard'});}
});

async function employeeRows(companyId:string, includeSensitive:boolean){
  const {data,error}=await admin.from('employees').select('*,departments(name),employee_statutory_details(pan,uan),employee_salary_assignments(annual_ctc,effective_from),employee_bank_details(bank_name,account_number)').eq('company_id',companyId).order('employee_id');
  if(error) throw error;
  return (data??[]).map((e:any)=>({employee_id:e.employee_id,name:`${e.first_name} ${e.last_name}`,department:e.departments?.name??'Unassigned',department_id:e.department_id??null,designation:e.designation??'',joining_date:e.date_of_joining,status:e.employment_status,employment_type:e.employment_type,work_location:e.work_location??'',reporting_manager:e.reporting_manager??'',pan:includeSensitive?(e.employee_statutory_details?.pan??''):maskPan(e.employee_statutory_details?.pan),uan:includeSensitive?(e.employee_statutory_details?.uan??''):maskPan(e.employee_statutory_details?.uan),bank:includeSensitive?`${e.employee_bank_details?.bank_name??''} ${e.employee_bank_details?.account_number??''}`.trim():(e.employee_bank_details?.bank_name?`${e.employee_bank_details.bank_name} ${maskBank(e.employee_bank_details.account_number)}`:'') ,annual_ctc:Number(e.employee_salary_assignments?.[0]?.annual_ctc??0),effective_from:e.employee_salary_assignments?.[0]?.effective_from??null,id:e.id}));
}
async function baseReport(req:AuthRequest,type:ReportType){
  const companyId=uuid.parse(String(req.query.company_id)); const m=await membership(req,companyId); if(!m) throw new Error('Company access denied');
  const month=req.query.month?Number(req.query.month):undefined, year=req.query.year?Number(req.query.year):undefined;
  const run=await resolveRun(companyId,month,year,req.query.payroll_run_id?String(req.query.payroll_run_id):undefined,true,req.query.financial_year?String(req.query.financial_year):undefined);
  return {companyId,m,run,month,year};
}

router.get('/types',async(req:AuthRequest,res)=>{ try { const companyId=uuid.parse(String(req.query.company_id)); if(!await membership(req,companyId)) return res.status(403).json({error:'Company access denied'}); res.json({reports:[
  ['payroll','Payroll Register','Detailed employee-wise payroll report for a selected payroll period.'],['summary','Payroll Summary','Payroll totals by department and available workforce dimensions.'],['employees','Employee Report','Employee master report with protected sensitive fields.'],['joiners','New Joiners','Employees whose joining date falls in the selected date range.'],['exits','Employee Exits','Employees with recorded last working dates in the selected date range.'],['salary','Salary Register','Effective salary structures and salary history.'],['salary-revisions','Salary Revision Report','Salary changes by employee and effective date.'],['attendance','Attendance Report','Attendance and paid-day report for the selected payroll period.'],['lop','LOP Report','Loss-of-pay days and deductions from attendance/payroll snapshots.'],['deductions','Deduction Report','Employee PF, PT, TDS, LOP and other deductions.'],['employer-cost','Employer Cost Report','Gross earnings and employer contribution cost.'],['statutory','Statutory Reports','Links to the existing Phase 8 statutory reports.'],['payslips','Payslip Status Report','Payslip generation status and versions from Phase 7.']].map(([id,name,description])=>({id,name,description,exportFormats:['Excel']}))}); }catch(e){res.status(400).json({error:'Unable to load reports'});} });

router.get('/:type',async(req:AuthRequest,res)=>{
  try{
    const type=reportType.parse(req.params.type); const {companyId,run,m,month,year}=await baseReport(req,type); let rows:any[]=[]; let summary:any={};
    if(type==='employees'||type==='joiners'||type==='exits'){
      rows=await employeeRows(companyId,['OWNER','COMPANY_ADMIN','HR'].includes(m.role));
      if(type==='joiners'||type==='exits'){ const from=String(req.query.date_from||'1900-01-01'),to=String(req.query.date_to||'2999-12-31'); rows=rows.filter(r=>type==='joiners'?r.joining_date>=from&&r.joining_date<=to:r.exit_date&&r.exit_date>=from&&r.exit_date<=to); if(req.query.department_id) rows=rows.filter(r=>r.department_id===String(req.query.department_id)); }
      if(req.query.status) rows=rows.filter(r=>r.status===String(req.query.status));
      summary={total:rows.length};
    } else if(type==='salary'||type==='salary-revisions'){
      const {data,error}=await admin.from('salary_structures').select('*,employees(employee_id,first_name,last_name,departments(name))').eq('company_id',companyId).order('effective_from',{ascending:false}); if(error) throw error;
      const all=(data??[]).map((s:any)=>({employee_id:s.employees?.employee_id??'',employee:`${s.employees?.first_name??''} ${s.employees?.last_name??''}`.trim(),department:s.employees?.departments?.name??'Unassigned',annual_ctc:Number(s.annual_ctc),monthly_ctc:Number(s.monthly_ctc),basic:Number(s.basic_salary),employer_pf:Number(s.employer_pf),special_allowance:Number(s.special_allowance),effective_from:s.effective_from,effective_to:s.effective_to,revision_version:1,status:s.status,id:s.id,employee_uuid:s.employee_id}));
      if(type==='salary'){ const grouped=new Map<string,any[]>(); all.forEach(r=>{const a=grouped.get(r.employee_uuid)||[];a.push(r);grouped.set(r.employee_uuid,a)}); rows=all.map(r=>{const versions=(grouped.get(r.employee_uuid)||[]).sort((a,b)=>String(a.effective_from).localeCompare(String(b.effective_from))); return {...r,revision_version:versions.findIndex(v=>v.id===r.id)+1};}); }
      else { rows=all.map((r:any,i:number)=>{ const prev=all.slice(i+1).find((x:any)=>x.employee_uuid===r.employee_uuid&&String(x.effective_from)<String(r.effective_from)); if(!prev)return null; const change=r.annual_ctc-prev.annual_ctc; return {...r,previous_salary:prev.annual_ctc,new_salary:r.annual_ctc,revision_date:r.created_at,effective_date:r.effective_from,reason:'Salary structure revision',approved_by:'Available in audit trail',change_amount:change,change_percentage:prev.annual_ctc?change/prev.annual_ctc*100:0}; }).filter(Boolean); }
      summary={total:rows.length};
    } else if(['payroll','summary','attendance','lop','deductions','employer-cost'].includes(type)){
      if(!run) return res.json({run:null,rows:[],summary:{},empty:true,message:'No payroll data available.'});
      rows=(await runRecords(companyId,run.id)).map(recordRow);
      if(req.query.department_id){ const depts=await departments(companyId); const id=String(req.query.department_id); const name=depts.find((d:any)=>d.id===id)?.name; rows=rows.filter(r=>r.department===name); }
      if(req.query.employee_id) rows=rows.filter(r=>r.employee_id_uuid===String(req.query.employee_id));
      if(type==='attendance'||type==='lop'){ rows=rows.map(r=>({employee_id:r.employee_id,employee:r.employee_name,department:r.department,working_days:r.working_days,present_days:r.present_days,paid_leave:r.paid_leave_days,lop_days:r.lop_days,paid_days:r.paid_days,lop_deduction:r.lop_deduction})); }
      if(type==='deductions'){ rows=rows.map(r=>({employee_id:r.employee_id,employee:r.employee_name,department:r.department,employee_pf:r.employee_pf,pt:r.pt,tds:r.tds,lop_deduction:r.lop_deduction,advance_recovery:0,other_deductions:r.other_deductions,total_deductions:r.total_deductions})); }
      if(type==='employer-cost'){ rows=rows.map(r=>({employee_id:r.employee_id,employee:r.employee_name,department:r.department,gross_earnings:r.gross,employer_pf:r.employer_pf,other_employer_contributions:0,total_employer_cost:r.employer_cost})); }
      if(type==='summary'){ const map=new Map<string,any>(); rows.forEach(r=>{const d=map.get(r.department)||{department:r.department,employees:0,gross:0,deductions:0,net:0,employer_contributions:0,employer_cost:0};d.employees++;d.gross+=r.gross;d.deductions+=r.total_deductions;d.net+=r.net_pay;d.employer_contributions+=r.employer_cost-r.gross;d.employer_cost+=r.employer_cost;map.set(r.department,d)}); rows=Array.from(map.values()); }
      summary={totalEmployees:rows.length,gross:rows.reduce((a,r)=>a+(r.gross||r.gross_earnings||0),0),deductions:rows.reduce((a,r)=>a+(r.total_deductions||0),0),net:rows.reduce((a,r)=>a+(r.net_pay||r.net||0),0),employerCost:rows.reduce((a,r)=>a+(r.employer_cost||r.total_employer_cost||0),0)};
    } else if(type==='statutory'){
      return res.json({links:[{label:'PF Report',path:'/compliance/pf'},{label:'ECR',path:'/compliance/pf'},{label:'PT Report',path:'/compliance/pt'},{label:'TDS Report',path:'/compliance/tds'},{label:'Statutory Payment Report',path:'/compliance/payments'}]});
    } else if(type==='payslips'){
      const q=admin.from('payslips').select('id,employee_id,payroll_run_id,pay_period_month,pay_period_year,status,generated_at,version,file_name,employees(employee_id,first_name,last_name)').eq('company_id',companyId).order('pay_period_year',{ascending:false}).order('pay_period_month',{ascending:false}).order('employee_id');
      if(month) q.eq('pay_period_month',month); if(year) q.eq('pay_period_year',year); if(req.query.status) q.eq('status',String(req.query.status)); const {data,error}=await q; if(error)throw error;
      rows=(data??[]).map((p:any)=>({id:p.id,employee_id:p.employees?.employee_id??'',employee:`${p.employees?.first_name??''} ${p.employees?.last_name??''}`.trim(),payroll_month:monthLabel(p.pay_period_month,p.pay_period_year),pay_period_month:p.pay_period_month,pay_period_year:p.pay_period_year,status:p.status,generated_at:p.generated_at,version:p.version,file_name:p.file_name})); summary={generated:rows.filter(r=>r.status==='GENERATED').length,not_generated:rows.filter(r=>r.status==='NOT_GENERATED').length,failed:rows.filter(r=>r.status==='FAILED').length,total:rows.length};
    }
    const page=Math.max(1,Number(req.query.page)||1), limit=Math.min(100,Math.max(10,Number(req.query.limit)||25)); const total=rows.length; const paged=rows.slice((page-1)*limit,page*limit); await audit(companyId,req.userId!,'REPORT_GENERATED',type,{page,limit,filters:{month,year,department_id:req.query.department_id||null,employee_id:req.query.employee_id||null}});
    res.json({run,financial_year:run?fy(run.payroll_month,run.payroll_year):(month&&year?fy(month,year):null),rows:paged,summary,total,page,limit,total_pages:Math.ceil(total/limit),departments:await departments(companyId)});
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to load report'});}
});

router.get('/:type/export',async(req:AuthRequest,res)=>{
  try{
    const type=reportType.parse(req.params.type); const {companyId,m}=await baseReport(req,type); if(type==='statutory') return res.status(400).json({error:'Statutory exports are provided by Phase 8.'});
    // Reuse the report endpoint logic without depending on browser pagination by invoking the same source queries directly.
    let rows:any[]=[]; const run=await resolveRun(companyId,req.query.month?Number(req.query.month):undefined,req.query.year?Number(req.query.year):undefined,req.query.payroll_run_id?String(req.query.payroll_run_id):undefined,true,req.query.financial_year?String(req.query.financial_year):undefined);
    if(['employees','joiners','exits'].includes(type)){ rows=await employeeRows(companyId,['OWNER','COMPANY_ADMIN','HR'].includes(m.role)); const from=String(req.query.date_from||'1900-01-01'),to=String(req.query.date_to||'2999-12-31'); if(type==='joiners')rows=rows.filter(r=>r.joining_date>=from&&r.joining_date<=to); if(type==='exits')rows=rows.filter(r=>r.exit_date&&r.exit_date>=from&&r.exit_date<=to); if(req.query.department_id)rows=rows.filter(r=>r.department_id===String(req.query.department_id)); if(req.query.status)rows=rows.filter(r=>r.status===String(req.query.status)); }
    else if(['salary','salary-revisions'].includes(type)){ const {data,error}=await admin.from('salary_structures').select('*,employees(employee_id,first_name,last_name,departments(name))').eq('company_id',companyId).order('effective_from',{ascending:false}); if(error)throw error; rows=(data??[]).map((s:any)=>({Employee:s.employees?.employee_id??'',EmployeeName:`${s.employees?.first_name??''} ${s.employees?.last_name??''}`.trim(),Department:s.employees?.departments?.name??'Unassigned',AnnualCTC:Number(s.annual_ctc),MonthlyCTC:Number(s.monthly_ctc),Basic:Number(s.basic_salary),EmployerPF:Number(s.employer_pf),SpecialAllowance:Number(s.special_allowance),EffectiveFrom:s.effective_from,EffectiveTo:s.effective_to,Status:s.status})); }
    else if(['payroll','summary','attendance','lop','deductions','employer-cost'].includes(type)){ if(!run)return res.status(404).json({error:'No payroll data available.'}); rows=(await runRecords(companyId,run.id)).map(recordRow); if(req.query.department_id){const ds=await departments(companyId);const n=ds.find((d:any)=>d.id===String(req.query.department_id))?.name;rows=rows.filter(r=>r.department===n);} if(type==='attendance'||type==='lop')rows=rows.map(r=>({EmployeeID:r.employee_id,Employee:r.employee_name,Department:r.department,WorkingDays:r.working_days,Present:r.present_days,PaidLeave:r.paid_leave_days,LOP:r.lop_days,PaidDays:r.paid_days,LOPDeduction:r.lop_deduction})); else if(type==='deductions')rows=rows.map(r=>({EmployeeID:r.employee_id,Employee:r.employee_name,Department:r.department,EmployeePF:r.employee_pf,PT:r.pt,TDS:r.tds,LOPDeduction:r.lop_deduction,OtherDeductions:r.other_deductions,TotalDeductions:r.total_deductions})); else if(type==='employer-cost')rows=rows.map(r=>({EmployeeID:r.employee_id,Employee:r.employee_name,Department:r.department,GrossEarnings:r.gross,EmployerPF:r.employer_pf,OtherEmployerContributions:0,TotalEmployerCost:r.employer_cost})); else rows=rows.map(r=>({EmployeeID:r.employee_id,Employee:r.employee_name,Department:r.department,Designation:r.designation,WorkingDays:r.working_days,PaidDays:r.paid_days,LOPDays:r.lop_days,Basic:r.basic,SpecialAllowance:r.special_allowance,OtherEarnings:r.other_earnings,Gross:r.gross,EmployeePF:r.employee_pf,PT:r.pt,TDS:r.tds,LOPDeduction:r.lop_deduction,OtherDeductions:r.other_deductions,TotalDeductions:r.total_deductions,NetPay:r.net_pay,EmployerPF:r.employer_pf,EmployerCost:r.employer_cost})); }
    else if(type==='payslips'){ const q=admin.from('payslips').select('id,pay_period_month,pay_period_year,status,generated_at,version,employees(employee_id,first_name,last_name)').eq('company_id',companyId).order('pay_period_year',{ascending:false}).order('pay_period_month',{ascending:false}); if(req.query.month)q.eq('pay_period_month',Number(req.query.month)); if(req.query.year)q.eq('pay_period_year',Number(req.query.year)); if(req.query.status)q.eq('status',String(req.query.status)); const {data,error}=await q; if(error)throw error; rows=(data??[]).map((p:any)=>({EmployeeID:p.employees?.employee_id??'',Employee:`${p.employees?.first_name??''} ${p.employees?.last_name??''}`.trim(),PayrollMonth:monthLabel(p.pay_period_month,p.pay_period_year),Status:p.status,GeneratedDate:p.generated_at,Version:p.version})); }
    const wb=XLSX.utils.book_new(); const header=[['Company',await companyName(companyId)],['Report',type],['Financial Year',run?fy(run.payroll_month,run.payroll_year):String(req.query.financial_year||'')],['Period',run?monthLabel(run.payroll_month,run.payroll_year):''],['Generated',new Date().toISOString()],['Filters',JSON.stringify({month:req.query.month||null,year:req.query.year||null,department_id:req.query.department_id||null,employee_id:req.query.employee_id||null})],[]];
    const ws=XLSX.utils.aoa_to_sheet(header); const dataSheet=XLSX.utils.json_to_sheet(rows); const range=XLSX.utils.decode_range(dataSheet['!ref']||'A1'); for(let c=range.s.c;c<=range.e.c;c++){const cell=dataSheet[XLSX.utils.encode_cell({r:0,c})];if(cell)cell.s={font:{bold:true}};} XLSX.utils.sheet_add_json(ws,rows,{origin:'A8'}); ws['!cols']=Object.keys(rows[0]||{}).map(k=>({wch:Math.min(32,Math.max(12,k.length+3))})); XLSX.utils.book_append_sheet(wb,ws,'Report');
    const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}); await audit(companyId,req.userId!,'REPORT_EXPORTED',type,{row_count:rows.length}); res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition',`attachment; filename="PayMate_${type}_${new Date().toISOString().slice(0,10)}.xlsx"`); res.send(buf);
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Unable to export report'});}
});

export default router;
