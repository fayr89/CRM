import dotenv from 'dotenv';

dotenv.config();

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

// КРИТИЧНЫЕ ПРОВЕРКИ ДЛЯ PRODUCTION
if (isProd) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me') {
    throw new Error('CRITICAL: JWT_SECRET must be set in production');
  }
  if (!process.env.ADMIN_PASSWORD) {
    throw new Error('CRITICAL: ADMIN_PASSWORD must be set in production');
  }
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error('CRITICAL: DATABASE_URL must be set in production');
  }
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  env,
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME || 'Администратор',
  },
};
