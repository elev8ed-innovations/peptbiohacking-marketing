# PeptBiohacking Checkout Launch Runbook

Last updated: 2026-07-18

## System map

- `peptbiohacking.com` is the marketing site, store, and checkout.
- `peptbiohacking.mx` is the member portal and is not the checkout application.
- GitHub repository: `elev8ed-innovations/peptbiohacking-marketing`.
- Netlify site: `elev8ed-peptbiohack`.
- Supabase project: `myymemctdxwizhmwjbyk`.
- Mercado Pago provides hosted payment collection.
- Airtable `Shop Inventory` is the server-side source for current prices and stock.
- Resend sends paid-order confirmation emails.

## Secure payment lifecycle

1. The browser sends only SKU, quantity, shipping details, and the optional consultation selection to `submit-order`.
2. `submit-order` validates every SKU, price, and available quantity against server-controlled catalog and Airtable data.
3. Supabase creates the order before contacting Mercado Pago and assigns an unpredictable public UUID.
4. Mercado Pago creates a preference whose `external_reference` is that order UUID.
5. The customer pays on Mercado Pago's hosted checkout.
6. Mercado Pago calls `mp-webhook`.
7. `mp-webhook` validates the HMAC signature, fetches the payment directly from Mercado Pago, and verifies mode, currency, amount, and order reference.
8. Only an approved, verified payment changes the order to `paid` and triggers confirmation emails.
9. The browser return page asks `payment-status` for the server-verified result. URL parameters alone cannot display a false confirmation.

## Scope completed on `codex/secure-mercado-pago-checkout`

- Rebuilt `submit-order` around an order-first payment lifecycle.
- Added Mercado Pago preference idempotency.
- Added the existing `mp-webhook` route to source control and replaced its unsigned, mismatched Airtable implementation.
- Added Mercado Pago HMAC webhook verification.
- Added payment amount, currency, environment, and external-reference verification.
- Added an anonymous-safe `payment-status` endpoint that returns status only.
- Delayed clinic and customer emails until payment approval.
- Added idempotency keys to paid-order emails.
- Escaped customer-controlled values in HTML emails.
- Fixed the browser/server mismatch that saved `ciudad` while the server expected `city`.
- Stopped clearing the cart before payment succeeds.
- Retired the legacy preference-only endpoint that created payments without linked orders.
- Added public UUID, payment detail, paid timestamp, and notification timestamp fields to orders.
- Removed direct anonymous inserts into `orders`.
- Removed the inventory admin password from public HTML and server source.
- Added server-secret validation for inventory and price administration.

## Required Supabase secrets

Never store these in GitHub, local `.env` files that are committed, chat, screenshots, or documentation.

- `MP_ACCESS_TOKEN`: Mercado Pago production access token.
- `MP_WEBHOOK_SECRET`: Mercado Pago Webhooks secret signature.
- `MP_ENVIRONMENT`: set to `production` for launch; use `test` only for a separate test deployment.
- `INVENTORY_ADMIN_PASSCODE`: new random passcode of at least 12 characters. Do not reuse the retired public code.
- `AIRTABLE_TOKEN`: already configured; verify it still has only the permissions required.
- `RESEND_API_KEY`: already configured.

## Deployment order

Do not change the order. It prevents the website from calling functions or columns that do not exist yet.

1. Confirm a current Supabase backup or acceptable restore point.
2. Add or rotate the four required secrets in Supabase.
3. Configure Mercado Pago Webhooks for payment events at:
   `https://myymemctdxwizhmwjbyk.supabase.co/functions/v1/mp-webhook`
4. Copy the generated Mercado Pago secret signature directly into `MP_WEBHOOK_SECRET`.
5. Apply migration `20260718090000_secure_mercado_pago_orders.sql`.
6. Deploy `mp-webhook`.
7. Deploy `payment-status`.
8. Deploy `verify-inventory-admin` and the updated inventory administration functions.
9. Deploy `submit-order`.
10. Deploy the branch to a Netlify preview and run the test matrix below.
11. Merge to `main` only after the preview and controlled payment pass.
12. Deploy the retired `create-mp-preference` implementation after confirming no client still calls it.

## Required test matrix

### Before a real charge

- Shop and checkout load on desktop and mobile widths.
- Empty cart cannot proceed.
- Invalid email and missing shipping fields are rejected.
- Unknown SKU is rejected by the server.
- Out-of-stock and excessive quantities are rejected.
- Browser price changes do not change the Mercado Pago amount.
- A preference opens Mercado Pago with the exact expected MXN total.
- Failed or cancelled payment returns without clearing the cart.
- Manually adding `?status=success` never displays a confirmed order.
- Invalid webhook signature returns `401` and changes no order.
- Duplicate approved webhook does not create duplicate emails.

### Controlled end-to-end payment

Use the lowest-priced approved product and a real buyer account that is different from the seller account.

- Record the expected product, quantity, consultation selection, and exact total.
- Complete one payment only.
- Confirm Mercado Pago shows the payment as approved.
- Confirm Supabase order status becomes `paid` with matching payment and preference IDs.
- Confirm the amount and currency match.
- Confirm customer and clinic each receive one email.
- Confirm the return page displays payment confirmation only after server verification.
- Confirm the order contains the complete city and shipping address.
- Confirm inventory handling with the clinic. Automatic stock decrement is not part of this release and remains an explicit operational decision.

## Launch gate

Launch is approved only when every item below is true:

- Production access token is installed directly in Supabase.
- Webhook secret signature is installed and HMAC validation passes.
- Database migration is applied successfully.
- Security Advisor is reviewed after the migration.
- All required Edge Functions are active.
- Netlify preview passes the non-charge test matrix.
- One controlled real payment passes end to end.
- A responsible person confirms how inventory is reduced after paid orders.
- Rollback owner and contact are known.

## Rollback

If checkout fails before a payment is created, restore the previous `submit-order` version and keep the store unavailable until order writes are confirmed.

If Mercado Pago accepts a payment but webhook verification fails:

1. Do not ask the customer to pay again.
2. Verify the payment in Mercado Pago using its payment ID.
3. Keep the order in `payment_review` until amount, currency, environment, and order reference are matched.
4. Fix or restore `mp-webhook`; Mercado Pago can retry failed webhook deliveries.

Netlify can roll back the marketing deployment independently. Do not roll back the database migration merely to remove the new columns; the migration is additive except for removing anonymous order inserts.

## Continuing work safely

- Start every change from an updated `main` branch and create a focused feature branch.
- Keep all pricing and payment decisions on the server.
- Never trust return URL parameters as proof of payment.
- Never expose service-role, Mercado Pago, Airtable, Resend, or admin secrets in browser code.
- Test on a Netlify preview before merging.
- Review `git diff`, run Deno checks, and run browser-script syntax checks before pushing.
- For database changes, create a new timestamped migration; never edit a migration already applied to production.
- Keep checkout, portal, and deployment responsibilities documented separately.
