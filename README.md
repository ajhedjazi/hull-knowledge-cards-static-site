# Hull Knowledge Cards

Independent Hull taxi knowledge revision built as a mobile-first React/Vite app.

## Validation stage

- Initial price: **£19.99**
- Initial access: **90 days**
- First commercial milestone: **five unrelated paying customers**
- Payments use an external **Stripe Payment Link**
- Access codes are issued manually
- The current access gate is deliberately lightweight
- Do not add full authentication until demand is validated

The client-side access-code gate is temporary validation infrastructure, not secure DRM. If the product validates, replace it with proper server-side authentication and entitlement checks.

## Launch configuration

### 1. Add the Stripe Payment Link

Open `src/config/product.js` and set `checkoutUrl` to the real Stripe Payment Link supplied from the Stripe dashboard:

```js
checkoutUrl: "https://buy.stripe.com/...",
```

Do not commit Stripe secret keys. This MVP only needs the public Payment Link URL.

If `checkoutUrl` is empty, development mode shows a clear configuration message instead of navigating to a broken URL. Production shows a neutral checkout-unavailable message.

### 2. Create or change temporary access codes

Open `src/config/accessCodes.js` and replace the obvious placeholder values with the manually issued validation codes you intend to give customers.

Keep codes unique and easy to communicate. These values are shipped in the browser bundle, so they must not be treated as secrets or as a durable authentication system.

When a valid code is first entered on a device, the app stores the activation timestamp and calculated expiry on that device. The expiry duration comes from `PRODUCT.accessDays` in `src/config/product.js`.

### 3. Deploy to Render

1. Push the completed `commercial-mvp` branch to GitHub.
2. In the Render service settings, set the deploy branch to `commercial-mvp` for the validation environment.
3. Use the existing build command: `npm run build`.
4. Use the existing static publish output configured by the project.
5. Deploy and verify the landing page, checkout CTA, access-code flow, flashcards, practice mode, 30-question mock, score screen and answer review on a phone-sized viewport.

Do **not** point the validation service at `main` unless intentionally changing the production branch later.

### 4. Revoke an access code for future activations

Remove that code from `src/config/accessCodes.js` and redeploy.

This prevents **future activations** using that code. It does not remotely revoke a device that already activated successfully, because this validation MVP stores the entitlement locally and has no server-side account system.

## Commercial copy guardrails

Hull Knowledge Cards is an independent revision resource. It is not affiliated with or endorsed by Hull City Council. Questions are provided for revision purposes and are not official council examination questions.

Do not add pass guarantees, invented pass marks, council branding, fake testimonials, artificial scarcity or claims of access to confidential council material.
