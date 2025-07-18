# n8n Community Edition SSO Demo

[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![nginx](https://img.shields.io/badge/nginx-%23009639.svg?style=for-the-badge&logo=nginx&logoColor=white)](https://nginx.org/)
[![Keycloak](https://img.shields.io/badge/Keycloak-4D4D4D?style=for-the-badge&logo=keycloak&logoColor=white)](https://www.keycloak.org/)
[![n8n](https://img.shields.io/badge/n8n-FF6D5A?style=for-the-badge&logo=n8n&logoColor=white)](https://n8n.io/)

A complete **Single Sign-On (SSO)** demonstration for **n8n Community Edition** using Docker Compose. This system integrates LDAP, Keycloak, nginx with oauth2-proxy, and automatic user provisioning in n8n through external hooks.

> **Inspired by:** This project was inspired by the excellent article [n8n & Authelia - Bypass n8n native login page using Trusted Header Single Sign-On](https://kb.jarylchng.com/i/n8n-and-authelia-bypass-n8n-native-login-page-usin-sNRmS-7j5u1/) by Jaryl Chng, which demonstrates how to implement trusted header SSO with n8n external hooks.

## Table of Contents

- [Solution Architecture](#solution-architecture)
- [Components](#components)
- [Quick Start](#quick-start)
- [Security](#security)
- [Logout](#logout)
- [Default Credentials](#default-credentials)
- [Troubleshooting](#troubleshooting)
- [Production Considerations](#production-considerations)
- [Environment Variables Reference](#environment-variables-reference)
- [Contributing](#contributing)
- [License](#license)

## Solution Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌────────────────┐
│     Browser     │───▶│    Nginx     │───▶│  oauth2-proxy   │───▶│   Keycloak     │
│                 │    │ (Reverse     │    │ (OAuth2/OIDC    │    │  (Identity     │
│                 │    │  Proxy)      │    │   Client)       │    │   Provider)    │
└─────────────────┘    └──────────────┘    └─────────────────┘    └────────────────┘
                                ▲                                           │
                                │                                           ▼
                        ┌───────────────┐                       ┌──────────────────┐
                        │      n8n      │                       │      LDAP        │
                        │  (Workflow    │                       │  (User Store)    │
                        │   Engine)     │                       │                  │
                        └───────────────┘                       └──────────────────┘
```

### Authentication Flow

1. **User** opens `http://localhost` → **nginx**
2. **nginx** checks authentication via `auth_request` to **oauth2-proxy**
3. If not authenticated → **oauth2-proxy** redirects to **Keycloak**
4. **Keycloak** authenticates user against **LDAP**
5. After successful login **oauth2-proxy** receives tokens and sets headers
6. **nginx** proxies request to **n8n** with trusted headers (`Remote-Email`, `Authorization` with JWT token)
7. **n8n hook** reads email header and decodes JWT to extract firstName/lastName from LDAP, then creates user and issues session cookie

## Components

### 1. LDAP Server (osixia/openldap)
- **Port:** 389
- **Admin:** `cn=admin,dc=example,dc=org` / `admin`
- **Demo User:** `jdoe` / `password` (email: `jdoe@example.org`)

### 2. Keycloak (Identity Provider)
- **Port:** 8080
- **Admin UI:** http://localhost:8080 (`admin` / `admin`)
- **Realm:** `demo`
- **LDAP federation:** configured automatically with proper mappers
- **OIDC client:** `oauth2-proxy`
- **Key Features:**
  - Email verification disabled (`verifyEmail: false`)
  - LDAP email trusted (`trustEmail: true`)
  - Proper attribute mappers for username, email, firstName, lastName

### 3. oauth2-proxy (OAuth2/OIDC Client)
- **Internal Port:** 4180
- **Provider:** Keycloak OIDC
- **Headers:** sets `X-Auth-Request-Email`, `X-Auth-Request-User`, `X-Auth-Request-Access-Token`, `Authorization`
- **Key Settings:**
  - `OAUTH2_PROXY_SKIP_OIDC_EMAIL_VERIFICATION=true`
  - `OAUTH2_PROXY_INSECURE_OIDC_ALLOW_UNVERIFIED_EMAIL=true`
  - `OAUTH2_PROXY_WHITELIST_DOMAINS=localhost`
  - `OAUTH2_PROXY_SET_XAUTHREQUEST=true`

### 4. nginx (Reverse Proxy)
- **Port:** 80
- **Architecture:** auth_request pattern (not full proxy)
- **Functions:**
  - Protects n8n access via `auth_request`
  - **SECURITY:** Strips any client-provided headers (`Remote-Email`, `Authorization`, `X-Auth-Request-Access-Token`)
  - Sets trusted headers only after successful authentication:
    - `Remote-Email` (user email)
    - `Authorization` (JWT token with user claims)
    - `X-Auth-Request-Access-Token` (OAuth2 access token)
  - Proxies requests to n8n with proper WebSocket support

### 5. n8n (Workflow Engine)
- **Port:** 5678 (direct access), 80 (via nginx)
- **External Hook:** automatically creates users with email, firstName, and lastName from LDAP
- **User Data Sources:** 
  - Email from `Remote-Email` header
  - First name and last name extracted from JWT token (LDAP `givenName` and `sn`)
- **Environment Variables:**
  - `EXTERNAL_HOOK_FILES=/home/node/.n8n/hooks.js`
  - `N8N_FORWARD_AUTH_HEADER=Remote-Email`

## Quick Start

### Requirements
- Docker Desktop or Docker with Docker Compose
- Available ports: 80, 389, 5678, 8080

### Setup
```bash
git clone <this-repo>
cd n8n-community-sso
docker compose up -d
```

### Checking Readiness
```bash
# Status of all services
docker compose ps

# Check Keycloak readiness
curl -s http://localhost:8080/realms/demo/.well-known/openid-configuration | head -c 100

# View logs
docker compose logs keycloak
docker compose logs oauth2-proxy
docker compose logs n8n
```

### Testing SSO
1. Open in browser: **http://localhost**
2. You'll be redirected to Keycloak for login
3. Use demo credentials:
   - **Username:** `jdoe`
   - **Password:** `password`
4. After successful login, you'll be redirected to n8n with automatic user creation including full name from LDAP

## Security

### Header Injection Protection
nginx is configured to **prevent header injection attacks**:

```nginx
# CRITICAL SECURITY: Strip any client-provided headers to prevent injection
proxy_set_header Remote-Email "";
proxy_set_header Authorization "";
proxy_set_header X-Auth-Request-Access-Token "";

# Set trusted headers ONLY after successful authentication
auth_request_set $email $upstream_http_x_auth_request_email;
auth_request_set $access_token $upstream_http_x_auth_request_access_token;
auth_request_set $auth_header $upstream_http_authorization;

proxy_set_header Remote-Email $email;
proxy_set_header X-Auth-Request-Access-Token $access_token;
proxy_set_header Authorization $auth_header;
```

### Security Principles
1. **nginx** never forwards user data headers (`Remote-Email`, `Authorization`, `X-Auth-Request-Access-Token`) from client
2. Headers are set only after successful `auth_request` to oauth2-proxy
3. oauth2-proxy validates tokens through Keycloak and provides JWT with user claims
4. Keycloak authenticates against LDAP and includes user details in JWT (email, given_name, family_name)
5. n8n hook decodes JWT to extract user data and creates users automatically

## Logout

### Automatic Logout
Navigate to: **http://localhost/logout**

This will:
1. Clear n8n session cookie
2. Redirect to oauth2-proxy logout
3. Initiate Keycloak logout
4. Redirect to Keycloak logout page

### Manual Logout
- **n8n:** http://localhost/logout
- **Keycloak:** http://localhost:8080/realms/demo/protocol/openid-connect/logout

## Default Credentials

### LDAP
- **Admin:** `cn=admin,dc=example,dc=org` / `admin`
- **Demo User:** `jdoe` / `password` (John Doe, jdoe@example.org)

### Keycloak
- **Admin:** `admin` / `admin`
- **Realm:** `demo`
- **Client:** `oauth2-proxy` / `oauth2proxysecret`

### n8n
- Users are created automatically on first login
- Default role: `global:member`

## Troubleshooting

### Common Issues

#### 1. oauth2-proxy restarting
```bash
docker compose logs oauth2-proxy
# Usually means Keycloak is not ready yet
```

#### 2. Keycloak slow startup
```bash
# Check readiness:
curl http://localhost:8080/realms/demo/.well-known/openid-configuration
```

#### 3. 500 Internal Server Error during callback
- This was caused by unverified email from LDAP
- Fixed with `OAUTH2_PROXY_SKIP_OIDC_EMAIL_VERIFICATION=true`
- And `verifyEmail: false` in Keycloak realm

#### 4. n8n not creating user
```bash
docker compose logs n8n | grep -i "sso\|Remote-Email"
# Check if header is coming through
```

#### 5. 502 Bad Gateway
```bash
docker compose ps
# Ensure all services are Up
```

#### 6. Invalid redirect errors
- Fixed with `OAUTH2_PROXY_WHITELIST_DOMAINS=localhost`

### Complete Reset
```bash
# This will remove all volumes including n8n cache, user data, and workflows
docker compose down -v
docker compose up -d
```

### Header Debugging
For debugging headers, you can temporarily add an echo service:
```bash
# Add to docker-compose.yaml:
echo:
  image: ealen/echo-server
  ports:
    - "8081:80"

# And in nginx.conf temporarily proxy to echo:80
# to see all headers
```

### Key Configuration Fixes Applied

1. **LDAP Mappers:** Added proper attribute mappers in Keycloak for username, email, firstName, lastName
2. **Email Verification:** Disabled in both Keycloak (`verifyEmail: false`) and oauth2-proxy (`OAUTH2_PROXY_SKIP_OIDC_EMAIL_VERIFICATION=true`)
3. **Trust Email:** Added `trustEmail: true` in LDAP configuration
4. **Redirect Validation:** Added `OAUTH2_PROXY_WHITELIST_DOMAINS=localhost`
5. **nginx Architecture:** Changed from full proxy to auth_request pattern
6. **Environment Variables:** Used correct n8n variables: `EXTERNAL_HOOK_FILES` and `N8N_FORWARD_AUTH_HEADER`

## Production Considerations

### Production Recommendations

#### 1. HTTPS Everywhere
- Add SSL certificates
- Configure HTTPS in nginx
- Change all URLs to https://

#### 2. Security
- Change all default passwords
- Use strong cookie secrets
- Configure firewall rules
- Enable proper logging

#### 3. Persistence
- Add external volumes for databases
- Configure Keycloak and n8n backups
- Use external databases (PostgreSQL)
- Consider persistent volumes for n8n workflows and cache in production
- Implement proper backup strategies for Docker volumes

#### 4. Monitoring
- Add health checks
- Configure structured logging
- Monitor metrics and alerts

#### 5. Scalability
- Use external databases
- Configure load balancing
- Redis for session storage

### Production Configuration Example
```yaml
# External PostgreSQL for Keycloak
# Redis for oauth2-proxy sessions  
# Let's Encrypt for SSL
# Separate networks for isolation
# Proper secrets management
# Health checks and monitoring
```

## Environment Variables Reference

### n8n
```bash
EXTERNAL_HOOK_FILES=/home/node/.n8n/hooks.js
N8N_FORWARD_AUTH_HEADER=Remote-Email
N8N_BASIC_AUTH_ACTIVE=false
N8N_USER_MANAGEMENT_DISABLED=false
```

### oauth2-proxy
```bash
OAUTH2_PROXY_PROVIDER=oidc
OAUTH2_PROXY_OIDC_ISSUER_URL=http://keycloak:8080/realms/demo
OAUTH2_PROXY_CLIENT_ID=oauth2-proxy
OAUTH2_PROXY_CLIENT_SECRET=oauth2proxysecret
OAUTH2_PROXY_SKIP_OIDC_EMAIL_VERIFICATION=true
OAUTH2_PROXY_INSECURE_OIDC_ALLOW_UNVERIFIED_EMAIL=true
OAUTH2_PROXY_WHITELIST_DOMAINS=localhost
OAUTH2_PROXY_SET_XAUTHREQUEST=true
OAUTH2_PROXY_SET_XAUTHREQUEST_HEADERS=X-Auth-Request-Email,X-Auth-Request-User,X-Auth-Request-Access-Token
OAUTH2_PROXY_PASS_ACCESS_TOKEN=true
OAUTH2_PROXY_PASS_AUTHORIZATION_HEADER=true
OAUTH2_PROXY_SET_AUTHORIZATION_HEADER=true
OAUTH2_PROXY_OIDC_EXTRA_AUDIENCES=oauth2-proxy
OAUTH2_PROXY_EXTRA_JWT_ISSUERS=http://keycloak:8080/realms/demo=oauth2-proxy
```

## Additional Information

### Useful Links
- [n8n Documentation](https://docs.n8n.io/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [oauth2-proxy Documentation](https://oauth2-proxy.github.io/oauth2-proxy/)
- [nginx auth_request module](http://nginx.org/en/docs/http/ngx_http_auth_request_module.html)

### Configuration Files
- `docker-compose.yaml` - Service orchestration with proper dependencies and Docker volumes
- `nginx/nginx.conf` - Reverse proxy configuration with auth_request pattern
- `keycloak/realm-export.json` - Pre-configured realm with LDAP federation and mappers
- `ldap/bootstrap.ldif` - Demo LDAP users
- `hooks.js` - n8n hook for automatic user provisioning

### Data Management
- **n8n cache**: Stored in Docker volume `n8n_cache` (cleaned with `docker compose down -v`)
- **LDAP data**: Temporary container storage (reset on container restart)
- **Keycloak data**: Temporary container storage (reset on container restart)
- **Demo environment**: All data is ephemeral for testing purposes

### Component Versions
- **n8n:** latest (n8nio/n8n) - tested on v1.102.4
- **Keycloak:** 24.0.1
- **oauth2-proxy:** v7.7.1
- **nginx:** alpine
- **OpenLDAP:** 1.5.0

## Summary

This demonstration provides a complete SSO integration for n8n Community Edition featuring:

- **LDAP** as user source with proper attribute mapping  
- **Keycloak** as Identity Provider with email verification disabled  
- **oauth2-proxy** as OAuth2/OIDC client with unverified email support  
- **nginx** as secure reverse proxy with auth_request pattern  
- **Automatic user provisioning** in n8n via external hooks with firstName and lastName from LDAP  
- **Secure header handling** with injection protection  
- **Complete logout flow** across all services  
- **Docker Desktop compatibility** with proper service networking  

**One command `docker compose up -d` deploys the entire SSO infrastructure ready for testing!**

### Test the Complete Flow

1. **Open:** http://localhost
2. **Login:** jdoe / password  
3. **Result:** Automatic redirect to n8n with created user account including:
   - **Email:** jdoe@example.org
   - **First Name:** John (from LDAP `givenName`)
   - **Last Name:** Doe (from LDAP `sn`)
   - **Role:** global:member

The system handles the complete authentication chain: Browser → nginx → oauth2-proxy → Keycloak → LDAP → JWT token with user claims → n8n hook decodes JWT and creates user with full profile.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Setup

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Reporting Issues

Please use the [GitHub Issues](../../issues) to report bugs or request features.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
