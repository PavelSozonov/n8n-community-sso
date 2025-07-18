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
            
            // Get email from the configured header (e.g., Remote-Email)
            const email = req.headers[headerName.toLowerCase()] || req.headers[headerName];
            
            if (!email) {
              this.logger?.debug(`No ${headerName} header found, skipping SSO auto-login`);
              return next();
            }
            
            const userEmail = Array.isArray(email) ? email[0] : String(email).trim();
            
            if (!userEmail || userEmail === '') {
              this.logger?.debug(`Empty ${headerName} header, skipping SSO auto-login`);
              return next();
            }

            this.logger?.info(`SSO auto-login attempt for email: ${userEmail}`);
            
            let user = await UserRepo.findOneBy({ email: userEmail });
            if (!user) {
              const hashed = await hash(randomBytes(16).toString('hex'), 10);
              user = (
                await UserRepo.createUserWithProject({
                  email: userEmail,
                  role: 'global:member',
                  password: hashed,
                })
              ).user;
              this.logger?.info(`Created new user: ${userEmail} via SSO`);
            } else {
              this.logger?.info(`Existing user logged in: ${userEmail} via SSO`);
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
