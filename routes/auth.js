const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAdmin } = require('../middlewares/auth');

router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);

router.get('/logout', authController.logout);

router.get('/register', isAdmin, (req, res) => res.render('register', { user: req.session.user, activePage: 'register', error: null, showBack: true }));
router.post('/register', isAdmin, authController.createUser);

module.exports = router;
