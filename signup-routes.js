// Signup routes to add to server.js

app.get('/signup', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'signUp.html'));
});

app.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    // Validation
    const errors = {};
    
    if (!name || name.trim().length < 2 || name.trim().length > 50) {
      errors.name = 'Name must be between 2 and 50 characters';
    }
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }
    
    if (!password || password.length < 8) {
      errors.password = 'Password must be at least 8 characters long';
    }
    
    if (!role || !['user', 'doctor'].includes(role)) {
      errors.role = 'Please select a valid account type';
    }
    
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    
    // Check if username/email already exists
    const username = email.split('@')[0]; // Use email prefix as username
    
    try {
      const existingUser = await getUserByUsername(username);
      if (existingUser) {
        errors.username = 'Username already exists';
      }
    } catch (error) {
      // User doesn't exist, which is good
    }
    
    try {
      const existingEmail = await getUserByEmail(email);
      if (existingEmail) {
        errors.email = 'Email already exists';
      }
    } catch (error) {
      // Email doesn't exist, which is good
    }
    
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    
    // Create user
    const userData = {
      username: username,
      email: email.trim(),
      password: password, // In a real app, hash this password
      full_name: name.trim(),
      role: role
    };
    
    const newUser = await createUser(userData);
    
    // Log admin action if admin is creating user
    if (req.session.role === 'admin') {
      logAdminAction(req.session.username, 'CREATE_USER', username, `Created ${role} account for ${name}`);
    }
    
    res.json({ 
      success: true, 
      message: 'Account created successfully! Please sign in.',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        full_name: newUser.full_name,
        role: newUser.role
      }
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    
    if (error.message.includes('already exists')) {
      if (error.message.includes('Username')) {
        res.status(400).json({ success: false, errors: { username: error.message } });
      } else if (error.message.includes('Email')) {
        res.status(400).json({ success: false, errors: { email: error.message } });
      } else {
        res.status(400).json({ success: false, errors: { general: error.message } });
      }
    } else {
      res.status(500).json({ success: false, message: 'An error occurred while creating your account. Please try again.' });
    }
  }
}); 