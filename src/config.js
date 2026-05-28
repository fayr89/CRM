import dotenv from 'dotenv';

dotenv.config();

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

// JWT_SECRET в production обязателен и не должен совпадать с дев-дефолтом —
// иначе любой, кто видел исходники, может выписать себе токен админа.
if (isProd) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me') {
    throw new Error(
      'JWT_SECRET не задан в production (или равен дев-дефолту). ' +
      'Установите случайное значение в Vercel env (≥ 32 байт) и сделайте Redeploy.',
    );
  }
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      '⚠️ ADMIN_PASSWORD не задан. Используется только при создании ПЕРВОГО админа ' +
      'на пустой БД — на работающем проде неактуально, но лучше задать на будущее.',
    );
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
    password: process.env.ADMIN_PASSWORD || 'admin123',
    name: process.env.ADMIN_NAME || 'Администратор',
  },
};
