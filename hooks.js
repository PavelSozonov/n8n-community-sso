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
            const email = req.headers[headerName.toLowerCase()];
            if (!email) return next();
            const userEmail = Array.isArray(email) ? email[0] : String(email);
            let user = await UserRepo.findOneBy({ email: userEmail });
            if (!user) {
              user = (
                await UserRepo.createUserWithProject({
                  email: userEmail,
                  role: 'global:member',
                  password: null,
                })
              ).user;
              this.logger?.info(`Created user ${userEmail} via forward auth`);
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
      }
    ]
  }
};
