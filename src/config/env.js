const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'heatline-central-backend',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  deviceSharedToken: process.env.DEVICE_SHARED_TOKEN || 'change-this-device-token',
  allowLegacySharedDeviceToken: String(process.env.ALLOW_LEGACY_SHARED_DEVICE_TOKEN || 'true').toLowerCase() === 'true',
  deviceProvisionKeyTtlMinutes: Number(process.env.DEVICE_PROVISION_KEY_TTL_MINUTES || 30),
  autoProxyDeviceCommands: String(process.env.AUTO_PROXY_DEVICE_COMMANDS || 'true').toLowerCase() === 'true',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 5000),

  // KMA / Weather automation
  kmaAuthKey: process.env.KMA_AUTH_KEY || '',
  weatherAutoEnabled: String(process.env.WEATHER_AUTO_ENABLED || 'true').toLowerCase() === 'true',
  weatherAutoIntervalMs: Number(process.env.WEATHER_AUTO_INTERVAL_MS || 10 * 60 * 1000),
  weatherAutoMonths: process.env.WEATHER_AUTO_MONTHS || '11,12,1,2,3',
  weatherAutoLeadMinutes: Number(process.env.WEATHER_AUTO_LEAD_MINUTES || 60),
  weatherAutoHoldMinutes: Number(process.env.WEATHER_AUTO_HOLD_MINUTES || 30),
  weatherAutoMinTemp: Number(process.env.WEATHER_AUTO_MIN_TEMP || 1),
  weatherAutoTriggerPty: process.env.WEATHER_AUTO_TRIGGER_PTY || '2,3,6,7',
  weatherAutoRequireAutoMode: String(process.env.WEATHER_AUTO_REQUIRE_AUTO_MODE || 'true').toLowerCase() === 'true',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'heatline',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10)
  }
};
