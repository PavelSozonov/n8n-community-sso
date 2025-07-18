module.exports = {
  n8n: {
    ready: [
      async function ({ app }, config) {
        const headerName = process.env.N8N_FORWARD_AUTH_HEADER;
        if (!headerName) {
          this.logger?.info('N8N_FORWARD_AUTH_HEADER not set; SSO middleware disabled.');
          return;
        }

        this.logger?.info(`SSO middleware initializing with header: ${headerName}`);

        const Layer = require('router/lib/layer');
        const { dirname, resolve } = require('path');
        const { randomBytes } = require('crypto');
        const { hash } = require('bcryptjs');
        const { issueCookie } = require(resolve(dirname(require.resolve('n8n')), 'auth/jwt'));
        const ignoreAuth = /^\/(assets|healthz|webhook|rest\/oauth2-credential|health)/;
        const cookieName = 'n8n-auth';
        const UserRepo = this.dbCollections.User;

        const { stack } = app.router;
        const idx = stack.findIndex((l) => l?.name === 'cookieParser');
        const layer = new Layer('/', { strict: false, end: false }, async (req, res, next) => {
          try {
            if (ignoreAuth.test(req.url)) return next();
            if (!config.get('userManagement.isInstanceOwnerSetUp', false)) return next();
            if (req.cookies?.[cookieName]) return next();
            
            // Get user data from headers
            const email = req.headers[headerName.toLowerCase()] || req.headers[headerName];
            const authHeader = req.headers['authorization'] || req.headers['x-auth-request-access-token'] || '';
            let firstName = '';
            let lastName = '';

            
            // Try to extract firstName and lastName from JWT token
            if (authHeader) {
              try {
                const token = authHeader.replace('Bearer ', '');
                if (token) {
                  // Decode JWT payload (base64 decode middle part)
                  const parts = token.split('.');
                  if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                    firstName = payload.given_name || payload.firstName || '';
                    lastName = payload.family_name || payload.lastName || '';
                    this.logger?.debug(`Extracted from JWT: firstName="${firstName}", lastName="${lastName}"`);
                  }
                }
              } catch (error) {
                this.logger?.debug(`Failed to decode JWT: ${error.message}`);
              }
            }
            
            // Fallback to headers if JWT extraction failed
            if (!firstName) firstName = req.headers['remote-given-name'] || '';
            if (!lastName) lastName = req.headers['remote-family-name'] || '';
            
            if (!email) {
              this.logger?.debug(`No ${headerName} header found, skipping SSO auto-login`);
              return next();
            }
            
            const userEmail = Array.isArray(email) ? email[0] : String(email).trim();
            const userFirstName = Array.isArray(firstName) ? firstName[0] : String(firstName).trim();
            const userLastName = Array.isArray(lastName) ? lastName[0] : String(lastName).trim();
            
            if (!userEmail || userEmail === '') {
              this.logger?.debug(`Empty ${headerName} header, skipping SSO auto-login`);
              return next();
            }

            this.logger?.info(`SSO auto-login attempt for email: ${userEmail}`);
            
            let user = await UserRepo.findOneBy({ email: userEmail });
            if (!user) {
              const hashed = await hash(randomBytes(16).toString('hex'), 10);
              
              // Prepare user data with firstName and lastName from LDAP
              const userData = {
                email: userEmail,
                role: 'global:member',
                password: hashed,
              };
              
              // Add firstName and lastName if available from LDAP
              if (userFirstName) userData.firstName = userFirstName;
              if (userLastName) userData.lastName = userLastName;
              
              user = (await UserRepo.createUserWithProject(userData)).user;
              
              this.logger?.info(`Created new user: ${userEmail} (${userFirstName} ${userLastName}) via SSO`);
            } else {
              // Update existing user's firstName and lastName if they changed in LDAP
              let userUpdated = false;
              if (userFirstName && user.firstName !== userFirstName) {
                user.firstName = userFirstName;
                userUpdated = true;
              }
              if (userLastName && user.lastName !== userLastName) {
                user.lastName = userLastName;
                userUpdated = true;
              }
              
              if (userUpdated) {
                await UserRepo.save(user);
                this.logger?.info(`Updated user: ${userEmail} (${userFirstName} ${userLastName}) via SSO`);
              } else {
                this.logger?.info(`Existing user logged in: ${userEmail} via SSO`);
              }
            }
            
            issueCookie(res, user);
            req.user = user;
            req.userId = user.id;
            return next();
          } catch (error) {
            this.logger?.error(`SSO middleware error: ${error.message}`);
            return next(error);
          }
        });
        
        stack.splice(idx + 1, 0, layer);
        this.logger?.info('SSO middleware initialized successfully');

        // Logout endpoint that clears n8n cookie and redirects to OAuth2 logout
        app.get('/logout', (req, res) => {
          this.logger?.info('User logout initiated');
          res.clearCookie(cookieName, { path: '/' });
          res.redirect('/oauth2/sign_out?rd=http://localhost:8080/realms/demo/protocol/openid-connect/logout');
        });
      }
    ]
  }
};
