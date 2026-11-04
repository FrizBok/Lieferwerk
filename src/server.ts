import path from 'node:path';
import { initDb, DATA_DIR } from './db.ts';
import { ensureAdmin, userFromRequest } from './auth.ts';
import { createApp, Router } from './lib/web.ts';
import { register as registerAuth } from './routes/auth.ts';
import { register as registerAdmin } from './routes/admin.ts';
import { register as registerCustomers } from './routes/customers.ts';
import { register as registerFleet } from './routes/fleet.ts';
import { register as registerOrders } from './routes/orders.ts';
import { register as registerWork } from './routes/work.ts';
import { register as registerDemo } from './routes/demo.ts';
import { register as registerPlan } from './routes/plan.ts';
import { register as registerReports } from './routes/reports.ts';
import { register as registerDelivery } from './routes/delivery.ts';

initDb();
ensureAdmin();

const router = new Router();
registerAuth(router);
registerAdmin(router);
registerFleet(router);
registerCustomers(router);
registerOrders(router);
registerWork(router);
registerDemo(router);
registerPlan(router);
registerReports(router);
registerDelivery(router);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const publicDir = path.resolve(import.meta.dirname, '..', 'public');

const server = createApp({ router, publicDir, loadUser: userFromRequest });
server.listen(port, host, () => {
  console.log(`Lieferwerk läuft auf http://localhost:${port}  (Daten: ${DATA_DIR})`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
