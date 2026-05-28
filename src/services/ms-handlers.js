// Регистрация обработчиков задач очереди МС.
// Side-effect модуль: импортируется один раз из src/app.js на старте лямбды.
import { registerMsHandler } from './ms-jobs.js';
import { customerOrderUpsertHandler } from './ms-orders.js';

registerMsHandler('customer_order.upsert', customerOrderUpsertHandler);
