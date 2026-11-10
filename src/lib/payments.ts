// Архитектура платёжных интеграций.
// Реестр провайдеров пуст по умолчанию: реальные платежи не принимаются и не имитируются.
// Чтобы подключить одобренного провайдера (после юридической проверки и договора):
//   1) создайте файл src/lib/providers/<id>.ts, вызовите registerProvider({...}) с реальным API провайдера;
//   2) импортируйте его в src/server.ts;
//   3) задайте ключи в .env и PAYMENT_<ID>_ENABLED=1;
//   4) включите функцию «Пополнение» в админ-панели (Система → Функции).
// Баланс начисляется только после подтверждения провайдера (webhook с проверкой подписи)
// или решения уполномоченного сотрудника в разделе «Финансы», и всегда через журнал ledger.

export type PaymentRequest = { requestId: number; amount: number; userId: number };
export type PaymentNext = { redirectUrl?: string; instructions?: string } | null;
export type WebhookResult = { requestId: number; amount: number; paid: boolean; externalId: string } | null;
export type PaymentProvider = {
  id: string;
  name: string;
  createPayment?: (r: PaymentRequest) => PaymentNext;
  verifyWebhook?: (headers: Record<string, any>, rawBody: string) => WebhookResult;
};

const registry: PaymentProvider[] = [];
export function registerProvider(p: PaymentProvider) {
  if (!/^[a-z0-9_]{2,32}$/.test(p.id)) throw new Error('bad provider id');
  registry.push(p);
}
export function paymentProviders(): PaymentProvider[] {
  return registry.filter((p) => process.env['PAYMENT_' + p.id.toUpperCase() + '_ENABLED'] === '1');
}
export const findProvider = (id: string) => paymentProviders().find((p) => p.id === id) || null;
