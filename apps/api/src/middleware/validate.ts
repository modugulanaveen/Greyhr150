import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

const paginationSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), search: z.string().trim().max(100).optional() }).partial();
export function validateCommonQuery(req: Request, res: Response, next: NextFunction) {
  const result = paginationSchema.safeParse(req.query);
  if (!result.success) { res.status(400).json({ error: 'Invalid query parameters' }); return; }
  next();
}
