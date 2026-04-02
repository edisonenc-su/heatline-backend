const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');

async function bootstrap() {
  try {
    await db.ping();
    app.listen(env.port, () => {
      console.log(`[heatline-central-backend] listening on port ${env.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
