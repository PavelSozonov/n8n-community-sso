module.exports = {
  'n8n.ready': [
    async function addForwardAuthMiddleware(server) {
      const headerName = process.env.N8N_FORWARD_AUTH_HEADER;
      if (!headerName) {
        this.logger?.info('N8N_FORWARD_AUTH_HEADER not set; SSO middleware disabled.');
        return;
      }

      const skipPaths = [
        '/assets',
        '/healthz',
        '/webhook',
        '/rest/oauth2-credential',
      ];

      const { issueCookie } = require('n8n/dist/auth/jwt');
      const cookieName = 'n8n-auth';
      const UserRepo = this.dbCollections.User;

      server.app.use(async (req, res, next) => {
        try {
          if (skipPaths.some((p) => req.path.startsWith(p))) return next();
          if (req.cookies?.[cookieName]) return next();

          const email = req.headers[headerName.toLowerCase()];
          if (!email) return next();

          const userEmail = Array.isArray(email) ? email[0] : String(email);
          const user = await UserRepo.findOneBy({ email: userEmail });

          if (!user) {
            res.status(401).send(`User ${userEmail} not found, please invite the user in n8n first.`);
            return;
          }

          issueCookie(res, user);
          // Make user available for the current request as well
          req.user = user;
          req.userId = user.id;
          next();
        } catch (error) {
          next(error);
        }
      });
    },
  ],
};
