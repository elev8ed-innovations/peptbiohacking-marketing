export function paymentMismatch(payment, order, requestedPaymentId) {
  if (!payment || String(payment.id ?? "") !== String(requestedPaymentId)) {
    return "payment ID";
  }
  if (!order?.external_reference || payment.external_reference !== order.external_reference) {
    return "external reference";
  }
  if (payment.currency_id !== "MXN") {
    return "currency";
  }

  const paidAmount = Number(payment.transaction_amount);
  const orderTotal = Number(order.total);
  if (
    !Number.isFinite(paidAmount) || !Number.isFinite(orderTotal)
    || paidAmount <= 0 || orderTotal <= 0
    || Math.round(paidAmount * 100) !== Math.round(orderTotal * 100)
  ) {
    return "amount";
  }
  if (
    order.status === "approved" && order.mp_payment_id
    && String(order.mp_payment_id) !== String(requestedPaymentId)
  ) {
    return "already approved with another payment";
  }
  return null;
}
