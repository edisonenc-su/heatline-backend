const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const { startWeatherAutoScheduler, stopWeatherAutoScheduler } = require('./services/weather-auto');

async function bootstrap() {
  try {
    await db.ping();
    await startWeatherAutoScheduler();

    const server = app.listen(env.port, () => {
      console.log(`[heatline-central-backend] listening on port ${env.port}`);
    });

    const shutdown = () => {
      stopWeatherAutoScheduler();
      server.close(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
