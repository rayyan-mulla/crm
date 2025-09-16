var express = require('express');
var router = express.Router();
const { isLoggedIn } = require('../middlewares/auth');

/* GET home page. */
router.get('/', isLoggedIn, function(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  res.render('index', { title: 'Express' });
});

module.exports = router;
