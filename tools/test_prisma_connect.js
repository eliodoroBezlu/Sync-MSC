require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

(async () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const r = await client.$queryRawUnsafe('SELECT 1 as v');
    console.log('OK', r);
  } catch (e) {
    console.error('ERR', e.message);
    process.exitCode = 2;
  } finally {
    await client.$disconnect();
  }
})();
