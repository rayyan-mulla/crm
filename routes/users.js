const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { isAdmin } = require('../middlewares/auth');

router.get('/', isAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.render('users', { user: req.session.user, activePage: 'users', users });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.get('/:id/edit', isAdmin, async (req, res) => {
  try {
    const editUser = await User.findById(req.params.id);
    if (!editUser) return res.redirect('/users');
    res.render('editUser', { editUser, user: req.session.user, activePage: 'editUser', error: null });
  } catch (err) {
    console.error(err);
    res.redirect('/users');
  }
});

router.post('/:id/edit', isAdmin, async (req, res) => {
  const { fullName, email, role, password } = req.body;

  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).send('User not found');
    }

    user.fullName = fullName;
    user.email = email;
    user.role = role;

    if (password && password.trim().length > 0) {
      user.password = password;
    }

    await user.save();
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    res.redirect('/users');
  }
});

router.post('/:id/delete', isAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    res.redirect('/users');
  }
});

module.exports = router;
