module.exports = {
  n8n: {
    ready: [
      async function ({ app }, config) {
        const headerName = process.env.N8N_FORWARD_AUTH_HEADER;
        if (!headerName) {
          this.logger?.info('N8N_FORWARD_AUTH_HEADER not set; SSO middleware disabled.');
          return;
        }

        const Layer = require('router/lib/layer');
        const { dirname, resolve } = require('path');
        const { randomBytes } = require('crypto');
        const { hash } = require('bcryptjs');
        const { issueCookie } = require(resolve(dirname(require.resolve('n8n')), 'auth/jwt'));
        const ignoreAuth = /^\/(assets|healthz|webhook|rest\/oauth2-credential)/;
        const cookieName = 'n8n-auth';
        const UserRepo = this.dbCollections.User;

        const { stack } = app.router;
        const idx = stack.findIndex((l) => l?.name === 'cookieParser');
        const layer = new Layer('/', { strict: false, end: false }, async (req, res, next) => {
          try {
            if (ignoreAuth.test(req.url)) return next();
            if (!config.get('userManagement.isInstanceOwnerSetUp', false)) return next();
            if (req.cookies?.[cookieName]) return next();
            
            // Check for oauth2-proxy headers
            const email = req.headers['x-forwarded-user'] || req.headers['x-auth-request-user'] || req.headers['x-forwarded-email'];
            if (!email) return next();
            
            const userEmail = Array.isArray(email) ? email[0] : String(email);
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
              this.logger?.info(`Created user ${userEmail} via oauth2-proxy`);
            }
            issueCookie(res, user);
            req.user = user;
            req.userId = user.id;
            return next();
          } catch (error) {
            return next(error);
          }
        });
        stack.splice(idx + 1, 0, layer);

        app.get('/logout', (req, res) => {
          res.clearCookie(cookieName);
          res.redirect('/oauth2/sign_out');
        });
      }
    ]
  }
};
