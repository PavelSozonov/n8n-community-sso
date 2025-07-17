# n8n Community SSO via External Hook

This repository provides an example `hooks.js` file that enables basic single sign-on for the community edition of **n8n** using an authenticating reverse proxy (e.g. Keycloak, Authelia). The hook listens for the `n8n.ready` event and attaches middleware to n8n's internal Express app to automatically log in users based on a forwarded email header.

## Usage

1. Mount `hooks.js` into your n8n container and set the environment variables:

```bash
EXTERNAL_HOOK_FILES=/home/node/.n8n/hooks.js
N8N_FORWARD_AUTH_HEADER=Remote-Email
```

2. Configure your proxy to authenticate users and pass their email in the header defined by `N8N_FORWARD_AUTH_HEADER`.
3. The middleware looks up the user by this email and issues the normal n8n auth cookie. If the user does not yet exist, it is automatically created with the default `member` role and a random password so the account is immediately active.

Requests that already contain a valid `n8n-auth` cookie or match public routes like `/assets`, `/healthz`, `/webhook`, or `/rest/oauth2-credential` are ignored.

The hook exports the `n8n.ready` handler in the modern format (`module.exports = { n8n: { ready: [...] } }`) and inserts the middleware right after the cookie parser layer for seamless integration.

See `hooks.js` for the implementation details.
