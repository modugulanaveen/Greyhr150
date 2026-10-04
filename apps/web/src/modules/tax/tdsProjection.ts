export interface ProjectedMonth { month:number; year:number; projectedSalary:number; eligibleDays:number; lopDays:number; daysInMonth:number; }
export function sumProjectedSalary(months:ProjectedMonth[]):number{return months.reduce((sum,m)=>sum+Math.max(0,Math.round(m.projectedSalary)),0);}
