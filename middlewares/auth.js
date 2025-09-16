// Ensure user is logged in
function isLoggedIn(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

// Ensure user is admin
function isAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden: Admins only');
  }
  next();
}

module.exports = { isLoggedIn, isAdmin };
