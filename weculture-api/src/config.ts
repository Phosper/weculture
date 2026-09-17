const localJwtSecret = 'weculture-local-development-secret';

export const isProduction = () => process.env.NODE_ENV === 'production';
export const isTest = () => process.env.NODE_ENV === 'test';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`生产环境缺少必需配置：${name}`);
  return value;
}

function requiredSecret(name: string) {
  const value = required(name);
  if (/^(replace|change|example)[-_ ]/i.test(value)) throw new Error(`生产环境 ${name} 不能使用示例占位值`);
  return value;
}

export function getJwtSecret() {
  const value = process.env.JWT_SECRET?.trim();
  if (isProduction()) {
    if (!value || /^(replace|change|example)[-_ ]/i.test(value) || value.length < 32) {
      throw new Error('生产环境 JWT_SECRET 必须设置为至少 32 个字符的随机值');
    }
    return value;
  }
  return value || localJwtSecret;
}

export function isDemoSeedEnabled() {
  return isProduction() ? process.env.SEED_DEMO_DATA === 'true' : process.env.SEED_DEMO_DATA !== 'false';
}

export function getSeedValue(name: string, developmentFallback: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (isProduction()) throw new Error(`生产环境启用演示种子数据时必须设置 ${name}`);
  return developmentFallback;
}

export function corsOrigins() {
  if (!isProduction()) return true;
  const configured = process.env.CORS_ORIGINS?.trim();
  if (!configured) return false;
  const origins = configured.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => !origin.startsWith('https://'))) throw new Error('生产环境 CORS_ORIGINS 必须是 HTTPS 域名列表');
  return origins;
}

export function validateRuntimeConfig() {
  getJwtSecret();
  if (!isProduction()) return;
  if (process.env.DB_TYPE !== 'mysql') throw new Error('生产环境 DB_TYPE 必须为 mysql');
  ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_DATABASE', 'WECHAT_APP_ID'].forEach(required);
  ['DB_PASSWORD', 'WECHAT_APP_SECRET'].forEach(requiredSecret);
  corsOrigins();
  if (isDemoSeedEnabled()) {
    ['ADMIN_INITIAL_PASSWORD', 'OPERATOR_INITIAL_PASSWORD', 'REVIEWER_INITIAL_PASSWORD'].forEach(requiredSecret);
    required('SCHOOL_INVITE_CODE');
  }
}
