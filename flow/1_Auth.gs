// ============== AUTHENTICATION ==============

function generateToken_() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function storeSession_(username, sheetId) {
  const token = generateToken_();
  const expiry = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const cache = CacheService.getScriptCache();

  // Store token -> session mapping (6 hour cache, refresh on use)
  cache.put(`session_${token}`, JSON.stringify({
    user: username,
    sheetId: sheetId,
    expiry: expiry
  }), 21600); // 6 hours in seconds

  return { token, expiry };
}

function validateToken_(token) {
  if (!token) return null;

  const cache = CacheService.getScriptCache();
  const sessionJson = cache.get(`session_${token}`);

  if (!sessionJson) return null;

  try {
    const session = JSON.parse(sessionJson);
    if (new Date(session.expiry) < new Date()) {
      cache.remove(`session_${token}`);
      return null;
    }
    // Refresh cache on successful validation
    cache.put(`session_${token}`, sessionJson, 21600);
    return session;
  } catch (e) {
    return null;
  }
}

/**
 * Secure authentication via POST
 * Returns short-lived token instead of sheetId
 */
function handleAuthPost_(payload) {
  logEntry_('handleAuthPost_', { user: payload.user });

  const username = (payload.user || '').toLowerCase().trim();
  const password = payload.pass || '';

  if (!username || !password) {
    log_('handleAuthPost_', 'Missing credentials', { username: !!username, password: !!password });
    logExit_('handleAuthPost_', { success: false, error: 'Missing credentials' });
    return json_({ success: false, error: 'Missing credentials' });
  }

  const props = PropertiesService.getScriptProperties();
  let users = {};

  try {
    const usersJson = props.getProperty('PULSE_USERS');
    if (usersJson) {
      users = JSON.parse(usersJson);
    }
  } catch (err) {
    logError_('handleAuthPost_', err, { stage: 'parsing users' });
    logExit_('handleAuthPost_', { success: false, error: 'Auth config error' });
    return json_({ success: false, error: 'Auth config error' });
  }

  const userConfig = users[username];
  if (!userConfig) {
    log_('handleAuthPost_', 'User not found', { username });
    logExit_('handleAuthPost_', { success: false, error: 'User not found' });
    return json_({ success: false, error: 'User not found' });
  }

  if (userConfig.pass !== password) {
    log_('handleAuthPost_', 'Invalid password', { username });
    logExit_('handleAuthPost_', { success: false, error: 'Invalid password' });
    return json_({ success: false, error: 'Invalid password' });
  }

  // Generate session token
  const { token, expiry } = storeSession_(username, userConfig.sheetId);
  log_('handleAuthPost_', 'Session created', { username, expiry, tokenPrefix: token.substring(0, 8) });

  logExit_('handleAuthPost_', { success: true, user: username });
  return json_({
    success: true,
    user: username,
    token: token,
    expiry: expiry,
    model: CONFIG.AI_MODEL_FRONTEND,
    modelDeep: CONFIG.AI_MODEL_FRONTEND_DEEP
  });
}

/**
 * Change password for authenticated user
 */
function handleChangePassword_(payload) {
  logEntry_('handleChangePassword_', { tokenPrefix: payload.token?.substring(0, 8) });

  const token = payload.token;
  const currentPass = payload.currentPass;
  const newPass = payload.newPass;

  // Validate token
  const session = validateToken_(token);
  if (!session) {
    log_('handleChangePassword_', 'Invalid session');
    logExit_('handleChangePassword_', { success: false, error: 'AUTH_REQUIRED' });
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  if (!currentPass || !newPass) {
    log_('handleChangePassword_', 'Missing password fields', { user: session.user });
    logExit_('handleChangePassword_', { success: false, error: 'Missing fields' });
    return json_({ error: 'Missing password fields' });
  }

  if (newPass.length < 6) {
    log_('handleChangePassword_', 'Password too short', { user: session.user });
    logExit_('handleChangePassword_', { success: false, error: 'Password too short' });
    return json_({ error: 'Password must be at least 6 characters' });
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const usersJson = props.getProperty('PULSE_USERS');
    if (!usersJson) {
      logExit_('handleChangePassword_', { success: false, error: 'No user config' });
      return json_({ error: 'User config not found' });
    }

    const users = JSON.parse(usersJson);
    const username = session.user;
    const userConfig = users[username];

    if (!userConfig) {
      logExit_('handleChangePassword_', { success: false, error: 'User not found' });
      return json_({ error: 'User not found' });
    }

    // Verify current password
    if (userConfig.pass !== currentPass) {
      log_('handleChangePassword_', 'Incorrect current password', { user: username });
      logExit_('handleChangePassword_', { success: false, error: 'Wrong password' });
      return json_({ error: 'Current password is incorrect' });
    }

    // Update password
    userConfig.pass = newPass;
    users[username] = userConfig;

    // Save back to properties
    props.setProperty('PULSE_USERS', JSON.stringify(users));

    log_('handleChangePassword_', 'Password updated', { user: username });
    logExit_('handleChangePassword_', { success: true, user: username });
    return json_({ success: true, message: 'Password updated successfully' });

  } catch (err) {
    logError_('handleChangePassword_', err, { user: session.user });
    logExit_('handleChangePassword_', { success: false, error: err.message });
    return json_({ error: 'Failed to update password: ' + err.message });
  }
}
