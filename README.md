# n8n Community SSO Demo

This repository demonstrates how to run **n8n Community Edition** with single sign-on using Keycloak and LDAP.  The setup uses a reverse proxy to authenticate users via Keycloak and then forwards their email to n8n where an external hook automatically provisions the user and issues the standard session cookie.

```
LDAP <-> Keycloak <-> oauth2-proxy + Nginx <-> n8n (hook.js)
```

## How it works
1. A user opens `http://localhost` which points to the Nginx reverse proxy.
2. Nginx asks `oauth2-proxy` to verify the request.  If the user is not logged in, `oauth2-proxy` redirects the browser to Keycloak.
3. Keycloak authenticates against the demo LDAP server and redirects back to `oauth2-proxy` which in turn redirects to Nginx.
4. After successful login `oauth2-proxy` exposes the authenticated email to Nginx via the `X-Auth-Request-Email` header.  Nginx clears any client-provided `Remote-Email` header, sets the trusted value and forwards the request to n8n.
5. n8n’s external hook (`hooks.js`) reads this header, finds or creates the user in its database and issues the `n8n-auth` cookie so the user is logged in automatically.
6. Visiting `/logout` clears the n8n cookie and then sends the browser to `oauth2-proxy` which logs the user out of Keycloak as well.

## Running the demo
Requires Docker and Docker Compose.

```bash
docker-compose up
```

Then open <http://localhost> in your browser.  You will be redirected to Keycloak.  Log in with the demo LDAP user credentials:

- **Username:** `jdoe`
- **Password:** `password`

Keycloak admin UI is available at <http://localhost:8080> (admin/admin).

## Default credentials
- LDAP admin: `cn=admin,dc=example,dc=org` / `admin`
- Keycloak admin: `admin` / `admin`
- Demo user: `jdoe` / `password`

## Security notes
- Nginx removes any `Remote-Email` header supplied by the client.
- Only after successful OAuth2 authentication does Nginx set the header from `oauth2-proxy`.
- n8n trusts this header to auto-login or create the user.

## Logout
Browse to `http://localhost/logout` to clear the n8n session and log out from Keycloak.

## Extending
This setup is for demo purposes.  Review the configs before using in production and consider enabling HTTPS, stronger secrets and persistent databases.
