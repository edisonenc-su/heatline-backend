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
  autoProxyDeviceCommands: String(process.env.AUTO_PROXY_DEVICE_COMMANDS || 'true').toLowerCase() === 'true',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'heatline',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10)
  }
};
