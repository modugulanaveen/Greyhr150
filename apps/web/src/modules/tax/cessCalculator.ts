import { roundTaxAmount } from '@paymate/shared';
export function calculateCess(tax:number, rate:number):number{return roundTaxAmount(Math.max(0,tax)*Math.max(0,rate)/100);}
