const isProduction = process.env.NODE_ENV === 'production';

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(isProduction ? 'Required server configuration is missing' : `Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  port: Number(process.env.PORT || 4000),
  webOrigins: (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',').map(v => v.trim()).filter(Boolean),
  appVersion: process.env.APP_VERSION || '1.8.0',
  maxJsonBody: process.env.MAX_JSON_BODY || '100kb',
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 120),
};

export function validateProductionConfig() {
  if (config.nodeEnv !== 'production') return;
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(name => !process.env[name]);
  if (!missing.length && !config.webOrigins.length) return;
  throw new Error('Required production configuration is missing');
}
