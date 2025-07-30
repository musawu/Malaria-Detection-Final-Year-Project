// Updated login route to work with database
// Replace the existing app.post('/login', ...) route with this:

app.post('/login', async (req, res) => {
  try {
    const { username, password, loginType } = req.body;

    // First check if it's a hardcoded admin user
    const hardcodedUsers = {
      admin: { password: 'admin123', role: 'admin' }
    };

    let user = hardcodedUsers[username];
    let isHardcoded = true;

    // If not hardcoded, check database
    if (!user) {
      try {
        const dbUser = await getUserByUsername(username);
        if (dbUser && dbUser.password === password) {
          user = {
            password: dbUser.password,
            role: dbUser.role
          };
          isHardcoded = false;
        }
      } catch (error) {
        // User not found in database
      }
    }

    // Validate credentials
    if (!user || user.password !== password) {
      return res.redirect('/login?error=Invalid username or password');
    }

    // Validate role matches login type
    if (loginType && loginType === 'doctor' && user.role !== 'doctor') {
      return res.redirect('/login?error=Invalid doctor credentials');
    }
    
    if (loginType && loginType === 'user' && user.role === 'doctor') {
      return res.redirect('/login?error=Please use doctor login for doctor accounts');
    }

    // Set session data
    req.session.loggedIn = true;
    req.session.username = username;
    req.session.role = user.role;
    
    if (user.role === 'doctor') {
      // For database users, we need to find their doctor ID
      if (!isHardcoded) {
        // You might want to add a doctor_id field to the users table
        // For now, we'll use a simple mapping
        const doctorMapping = {
          'doctor1': '1',
          'doctor2': '2'
        };
        req.session.doctorId = doctorMapping[username] || '1';
      } else {
        // For hardcoded doctors
        const doctorMapping = {
          'doctor1': '1',
          'doctor2': '2'
        };
        req.session.doctorId = doctorMapping[username];
      }
    }

    console.log(`User ${username} logged in as ${user.role}`);
    
    // Log admin login
    if (user.role === 'admin') {
      logAdminAction(username, 'LOGIN', null, 'Admin logged into system');
    }
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.redirect('/login?error=An error occurred during login');
  }
}); 