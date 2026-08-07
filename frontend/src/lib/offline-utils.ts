/**
 * Utility to check if the application is running in local-only offline mode.
 * Now hardcoded to false since offline mode is removed.
 */
export const isLocalOnlyMode = () => {
  return false;
};

/**
 * Utility to check if the current environment is local (localhost or 127.0.0.1).
 */
export const isLocalEnvironment = () => {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
};