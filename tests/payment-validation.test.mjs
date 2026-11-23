import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentMismatch } from "../supabase/functions/mercado-pago-webhook/payment-validation.mjs";

const order = {
  external_reference: "order-123",
  total: 3900,
  status: "pending",
  mp_payment_id: null,
};
const payment = {
  id: 456,
  external_reference: "order-123",
  transaction_amount: 3900,
  currency_id: "MXN",
  status: "approved",
};

test("accepts only a payment matching the stored order", () => {
  assert.equal(paymentMismatch(payment, order, "456"), null);
  assert.equal(paymentMismatch({ ...payment, id: 999 }, order, "456"), "payment ID");
  assert.equal(paymentMismatch({ ...payment, external_reference: "another-order" }, order, "456"), "external reference");
  assert.equal(paymentMismatch({ ...payment, currency_id: "USD" }, order, "456"), "currency");
  assert.equal(paymentMismatch({ ...payment, transaction_amount: 39 }, order, "456"), "amount");
  assert.equal(paymentMismatch({ ...payment, transaction_amount: null }, order, "456"), "amount");
  assert.equal(paymentMismatch({ ...payment, transaction_amount: 0 }, { ...order, total: 0 }, "456"), "amount");
});

test("rejects a second payment on an approved order", () => {
  assert.equal(paymentMismatch(payment, { ...order, status: "approved", mp_payment_id: "123" }, "456"), "already approved with another payment");
  assert.equal(paymentMismatch(payment, { ...order, status: "approved", mp_payment_id: "456" }, "456"), null);
});
