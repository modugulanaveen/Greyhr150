import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentStatus, validateUan, validateEcrRows, formatEcrRows, roundComplianceAmount } from '../packages/shared/src/compliance.ts';

test('PF snapshot values are rounded to whole rupees',()=>assert.equal(roundComplianceAmount(1200.49),1200));
test('valid UAN passes validation',()=>assert.equal(validateUan('123456789012'),true));
test('invalid UAN fails validation',()=>assert.equal(validateUan('1234'),false));
test('duplicate UAN and missing UAN are ECR errors',()=>{const errors=validateEcrRows([{employeeId:'E1',employeeName:'A',uan:'123456789012',pfEligible:true,pfWage:10000,employeePf:1200,employerPf:1200,eps:0,edli:0},{employeeId:'E2',employeeName:'B',uan:'123456789012',pfEligible:true,pfWage:10000,employeePf:1200,employerPf:1200,eps:0,edli:0},{employeeId:'E3',employeeName:'C',uan:null,pfEligible:true,pfWage:10000,employeePf:1200,employerPf:1200,eps:0,edli:0}]);assert.equal(errors.length,2)});
test('ECR formatter preserves approved payroll snapshot values',()=>{const s=formatEcrRows([{employeeId:'E1',employeeName:'A',uan:'123456789012',pfEligible:true,pfWage:20000,employeePf:2400,employerPf:2400,eps:0,edli:0}]);assert.match(s,/123456789012#A#20000#2400#2400#0#0/)});
test('payment status is pending before due date',()=>assert.equal(paymentStatus(50000,0,'2099-01-01',new Date('2026-09-30')),'PENDING'));
test('partial payment leaves balance',()=>assert.equal(paymentStatus(50000,30000,'2099-01-01'),'PARTIALLY_PAID'));
test('fully paid liability is paid',()=>assert.equal(paymentStatus(50000,50000,'2020-01-01'),'PAID'));
test('overdue unpaid liability is overdue',()=>assert.equal(paymentStatus(50000,0,'2020-01-01',new Date('2026-09-30')),'OVERDUE'));
test('non-PF employees are excluded from ECR formatting',()=>assert.equal(formatEcrRows([{employeeId:'E1',employeeName:'A',uan:null,pfEligible:false,pfWage:0,employeePf:0,employerPf:0,eps:0,edli:0}]),''));
