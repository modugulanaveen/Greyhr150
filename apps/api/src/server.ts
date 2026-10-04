import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateProductionConfig } from './lib/config.js';
import { rateLimit, cleanupRateLimitBuckets } from './middleware/rateLimit.js';
import { validateCommonQuery } from './middleware/validate.js';
import companies from './routes/companies.js';
import employees from './routes/employees.js';
import salaryStructures from './routes/salaryStructures.js';
import attendance from './routes/attendance.js';
import tds from './routes/tds.js';
import payroll from './routes/payroll.js';
import payslips from './routes/payslips.js';
import compliance from './routes/compliance.js';
import reports from './routes/reports.js';
import settings from './routes/settings.js';

validateProductionConfig();
const app = express();
const origins = config.webOrigins;
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: (origin, callback) => { if (!origin || origins.includes(origin)) return callback(null, true); return callback(new Error('Origin not allowed')); }, credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Authorization','Content-Type'] }));
app.use(express.json({ limit: config.maxJsonBody }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(rateLimit({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax, keyPrefix: 'global' }));
setInterval(cleanupRateLimitBuckets, Math.max(config.rateLimitWindowMs, 60_000)).unref();

const health = (_req: express.Request, res: express.Response) => res.json({ status: 'ok', service: 'paymate-api', version: config.appVersion });
app.get('/health', health);
app.get('/api/health', health);

app.use('/api/companies', validateCommonQuery, companies);
app.use('/api/employees', validateCommonQuery, employees);
app.use('/api/salary-structures', validateCommonQuery, salaryStructures);
app.use('/api/attendance', validateCommonQuery, attendance);
app.use('/api/tds', validateCommonQuery, tds);
app.use('/api/payroll', validateCommonQuery, payroll);
app.use('/api/payslips', validateCommonQuery, payslips);
app.use('/api/compliance', validateCommonQuery, compliance);
app.use('/api/reports', reports);
app.use('/api/settings', validateCommonQuery, settings);

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled API error', err instanceof Error ? err.message : 'unknown error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (process.env.NODE_ENV !== 'test') app.listen(config.port, () => console.log(`PayMate API listening on port ${config.port}`));
export { app };
