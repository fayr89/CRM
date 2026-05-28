// Регистрация обработчиков задач очереди МС.
// Side-effect модуль: импортируется один раз из src/app.js на старте лямбды.
import { registerMsHandler } from './ms-jobs.js';
import {
  customerOrderUpsertHandler,
  demandCreateHandler,
  demandDeleteHandler,
  customerReturnCreateHandler,
  lossCreateHandler,
  markdownCreateHandler,
  markdownUndoHandler,
} from './ms-orders.js';

registerMsHandler('customer_order.upsert', customerOrderUpsertHandler);
registerMsHandler('demand.create', demandCreateHandler);
registerMsHandler('demand.delete', demandDeleteHandler);
registerMsHandler('customerreturn.create', customerReturnCreateHandler);
registerMsHandler('loss.create', lossCreateHandler);
registerMsHandler('markdown.create', markdownCreateHandler);
registerMsHandler('markdown.undo', markdownUndoHandler);
