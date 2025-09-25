// controllers/authController.js
const User = require('../models/User');

exports.getLogin = (req, res) => {
  res.render('login', { error: null, username: '' });
};

exports.postLogin = async (req, res) => {
  const { username = '', password = '' } = req.body;
  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.render('login', { error: 'Invalid username or password', username });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.render('login', { error: 'Invalid username or password', username });
    }

    // store minimal user info in session
    req.session.user = {
      id: user._id.toString(),
      username: user.username,
      fullName: user.fullName,
      role: user.role
    };

    return res.redirect('/');
  } catch (err) {
    console.error(err);
    return res.render('login', { error: 'Server error. Try again.', username });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(err => {
    // ignore error on destroy for simple flow
    res.clearCookie('connect.sid');
    res.redirect('/auth/login');
  });
};

exports.createUser = async (req, res) => {
  const { fullName, username, email, password, role } = req.body;

  try {
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.render('register', { error: 'Username already exists' });
    }

    const newUser = new User({
      fullName,
      username: username.toLowerCase(),
      email,
      password,
      role: role || 'user'
    });

    await newUser.save();
    res.redirect('/users'); // or wherever you list users
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'Error creating user' });
  }
};
