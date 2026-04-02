const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const { success, fail } = require('./utils/http');

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const userRoutes = require('./routes/users');
const controllerRoutes = require('./routes/controllers');
const logRoutes = require('./routes/logs');

const app = express();

app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map(v => v.trim()), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  return success(res, {
    name: env.appName,
    ok: true,
    version: '1.0.0'
  });
});

app.get('/api/v1/health', (req, res) => {
  return success(res, { ok: true });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/controllers', controllerRoutes);
app.use('/api/v1', logRoutes);

app.use((req, res) => fail(res, 404, '요청한 API를 찾을 수 없습니다.', 'NOT_FOUND'));

app.use((error, req, res, next) => {
  console.error(error);
  return fail(res, error.status || 500, error.message || '서버 내부 오류가 발생했습니다.', error.code || 'INTERNAL_SERVER_ERROR');
});

module.exports = app;
